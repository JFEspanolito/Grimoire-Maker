export type DiffLineKind = 'h1' | 'h2' | 'h3' | 'quote' | 'list' | 'body'

export interface DiffLine {
  text: string
  number: number
  changed: boolean
  kind?: DiffLineKind
}

export interface DiffRow {
  original?: DiffLine
  incoming?: DiffLine
  file?: string
  note?: string
}

const GIT_METADATA_LINE =
  /^(?:index [0-9a-f]+\.\.[0-9a-f]+|(?:similarity|dissimilarity) index \d+%|rename (?:from|to) |copy (?:from|to) |(?:new|deleted|old) (?:file )?mode \d+|--- |\+\+\+ |\\ No newline at end of file)/

function extractFilePath(header: string): string | null {
  // Matches: diff --git a/path/to/file.md b/path/to/file.md (or -R reversed b/... a/...)
  const quoted = /^diff --git "?[ab]\/(.+?)"? "?[ab]\/(.+?)"?$/.exec(header.trim())
  if (!quoted) return null
  const [, first, second] = quoted
  // Prefer the non-Trash path if Git paired a file with Trash
  if (first.startsWith('Trash/') && !second.startsWith('Trash/')) return second
  if (second.startsWith('Trash/') && !first.startsWith('Trash/')) return first
  return second
}

function formatViewerLine(raw: string): { text: string; kind: DiffLineKind; skip: boolean } {
  const trimmed = raw.trim()
  const hasHtml = /<[^>]+>/.test(raw)

  let kind: DiffLineKind = 'body'
  if (/<h1\b/i.test(raw) || /^#\s+/.test(trimmed)) kind = 'h1'
  else if (/<h2\b/i.test(raw) || /^##\s+/.test(trimmed)) kind = 'h2'
  else if (/<h[3-6]\b/i.test(raw) || /^#{3,6}\s+/.test(trimmed)) kind = 'h3'
  else if (/<blockquote\b/i.test(raw) || /^>\s+/.test(trimmed)) kind = 'quote'
  else if (/<li\b/i.test(raw) || /^[-*]\s+/.test(trimmed)) kind = 'list'

  let text = raw
  if (hasHtml) {
    text = text
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
    // Skip standalone HTML container tags like <div> or </div> that carry no text
    if (!text.trim()) {
      return { text: '', kind, skip: true }
    }
  }

  text = text
    .replace(/^\s*#{1,6}\s+/, '')
    .replace(/^\s*>\s+/, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')

  return { text, kind, skip: false }
}

/** Align each changed block into clean, viewer-style rows without raw Git plumbing headers. */
export function splitDiff(text: string): DiffRow[] {
  const rows: DiffRow[] = []
  let original = 1
  let incoming = 1
  let inHunk = false
  let skipCurrentFile = false
  let pendingFile: string | null = null
  let removed: DiffLine[] = []
  let added: DiffLine[] = []

  const emitPendingFile = () => {
    if (pendingFile) {
      rows.push({ file: pendingFile })
      pendingFile = null
    }
  }

  const flush = () => {
    if (!removed.length && !added.length) return
    emitPendingFile()
    for (let index = 0; index < Math.max(removed.length, added.length); index++) {
      rows.push({ original: removed[index], incoming: added[index] })
    }
    removed = []
    added = []
  }

  const lines = text.split(/\r?\n/)
  if (lines.at(-1) === '') lines.pop()
  const limit = 5000

  for (const line of lines.slice(0, limit)) {
    if (line.startsWith('diff --git ')) {
      flush()
      inHunk = false
      const filePath = extractFilePath(line)
      if (filePath && filePath.startsWith('Trash/')) {
        skipCurrentFile = true
        pendingFile = null
      } else {
        skipCurrentFile = false
        pendingFile = filePath
      }
      continue
    }

    if (skipCurrentFile) continue

    if (line.startsWith('New file: ')) {
      flush()
      inHunk = true
      const filePath = line.slice('New file: '.length).trim()
      if (filePath.startsWith('Trash/')) {
        skipCurrentFile = true
        pendingFile = null
      } else {
        pendingFile = filePath
      }
      continue
    }

    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    if (hunk) {
      flush()
      original = Number(hunk[1])
      incoming = Number(hunk[2])
      inHunk = true
      continue
    }

    if (GIT_METADATA_LINE.test(line)) {
      continue
    }

    if (line.startsWith('-')) {
      const formatted = formatViewerLine(line.slice(1))
      const lineNum = original++
      if (!formatted.skip) {
        removed.push({ text: formatted.text, number: lineNum, changed: true, kind: formatted.kind })
      }
    } else if (line.startsWith('+')) {
      const formatted = formatViewerLine(line.slice(1))
      const lineNum = incoming++
      if (!formatted.skip) {
        added.push({ text: formatted.text, number: lineNum, changed: true, kind: formatted.kind })
      }
    } else {
      flush()
      if (inHunk && line.startsWith(' ')) {
        const formatted = formatViewerLine(line.slice(1))
        const origNum = original++
        const incNum = incoming++
        if (!formatted.skip) {
          emitPendingFile()
          rows.push({
            original: { text: formatted.text, number: origNum, changed: false, kind: formatted.kind },
            incoming: { text: formatted.text, number: incNum, changed: false, kind: formatted.kind },
          })
        }
      } else if (line.trim()) {
        rows.push({ note: line })
      }
    }
  }

  flush()
  if (lines.length > limit) {
    rows.push({ note: 'Preview limited to the first 5,000 diff lines. Remaining changes are not shown.' })
  }
  return rows
}
