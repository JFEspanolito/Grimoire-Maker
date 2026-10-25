interface DiffLine { text: string; number: number; changed: boolean }
export interface DiffRow { original?: DiffLine; incoming?: DiffLine; note?: string }

/** Align each changed block, retaining context and Git hunk line numbers. */
export function splitDiff(text: string): DiffRow[] {
  const rows: DiffRow[] = []
  let original = 1
  let incoming = 1
  let inHunk = false
  let removed: DiffLine[] = []
  let added: DiffLine[] = []
  const flush = () => {
    for (let index = 0; index < Math.max(removed.length, added.length); index++) {
      rows.push({ original: removed[index], incoming: added[index] })
    }
    removed = []; added = []
  }
  const lines = text.split(/\r?\n/)
  if (lines.at(-1) === '') lines.pop()
  const limit = 5000
  for (const line of lines.slice(0, limit)) {
    if (line.startsWith('New file: ') || line.startsWith('diff --git ')) {
      flush(); inHunk = line.startsWith('New file: ')
      rows.push({ note: line }); continue
    }
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    if (hunk) {
      flush(); original = Number(hunk[1]); incoming = Number(hunk[2]); inHunk = true
      rows.push({ note: line }); continue
    }
    if (!inHunk && (line.startsWith('--- ') || line.startsWith('+++ '))) continue
    if (line.startsWith('-')) removed.push({ text: line.slice(1), number: original++, changed: true })
    else if (line.startsWith('+')) added.push({ text: line.slice(1), number: incoming++, changed: true })
    else {
      flush()
      if (inHunk && line.startsWith(' ')) rows.push({
        original: { text: line.slice(1), number: original++, changed: false },
        incoming: { text: line.slice(1), number: incoming++, changed: false },
      })
      else rows.push({ note: line })
    }
  }
  flush()
  if (lines.length > limit) rows.push({ note: 'Preview limited to the first 5,000 diff lines. Remaining changes are not shown.' })
  return rows
}
