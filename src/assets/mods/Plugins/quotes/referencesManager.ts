import { exists, readDir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { serializeDocument, parseDocument } from '../../../../lib/frontmatter'
import { useDocumentStore } from '../../../../stores/documentStore'
import { getActiveSnippetDropTarget } from '../../../../lib/snippetDrop'
import type { FileNode } from '../../../../types/document'
import type { Quote } from './quotesStore'
import { useQuotes } from './quotesStore'
import { CitationFormatter, type CitationStyle, type ReferenceItem } from './citationFormatter'

export interface ReferenceResult {
  referenceNumber: number
  quoteMarkdown: string
}

function toNormalizedRelative(root: string, path: string): string {
  const normRoot = root.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()
  const normPath = path.replaceAll('\\', '/').toLowerCase()
  if (normPath.startsWith(`${normRoot}/`)) {
    return normPath.slice(normRoot.length + 1)
  }
  return normPath
}

function commonPrefixSegments(p1: string, p2: string): number {
  const s1 = p1.replaceAll('\\', '/').toLowerCase().split('/').filter(Boolean)
  const s2 = p2.replaceAll('\\', '/').toLowerCase().split('/').filter(Boolean)
  let count = 0
  for (let i = 0; i < Math.min(s1.length, s2.length); i++) {
    if (s1[i] === s2[i]) count++
    else break
  }
  return count
}

function searchTreeForReferences(nodes: FileNode[]): string[] {
  const matches: string[] = []
  for (const node of nodes) {
    if (node.isDirectory && node.children) {
      matches.push(...searchTreeForReferences(node.children))
    } else if (node.name.toLowerCase() === 'references.md') {
      matches.push(node.path.replaceAll('\\', '/'))
    }
  }
  return matches
}

async function scanDirectoryForReferences(dir: string, depth = 0): Promise<string[]> {
  if (depth > 6) return []
  try {
    const entries = await readDir(dir)
    const matches: string[] = []
    const subdirs: string[] = []
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const full = `${dir}/${entry.name}`.replaceAll('\\', '/')
      if (entry.isDirectory) {
        subdirs.push(full)
      } else if (entry.name.toLowerCase() === 'references.md') {
        matches.push(full)
      }
    }
    for (const sub of subdirs) {
      const nested = await scanDirectoryForReferences(sub, depth + 1)
      matches.push(...nested)
    }
    return matches
  } catch {
    return []
  }
}

/**
 * Searches the workspace for an existing References.md file (e.g. inside subfolders or template chapters).
 * If multiple exist, chooses the one with the strongest path proximity to the quote source.
 */
export async function findReferencesFile(root: string, contextPath?: string): Promise<string> {
  const normRoot = root.replaceAll('\\', '/').replace(/\/+$/, '')
  const candidates: string[] = []

  // 1. Check in-memory document tree
  try {
    const tree = useDocumentStore.getState().tree
    if (Array.isArray(tree) && tree.length > 0) {
      candidates.push(...searchTreeForReferences(tree))
    }
  } catch {
    // ignore
  }

  // 2. Scan Draft directory on disk
  const draftDir = `${normRoot}/Draft`
  try {
    const diskMatches = await scanDirectoryForReferences(draftDir)
    candidates.push(...diskMatches)
  } catch {
    // ignore
  }

  const uniqueCandidates = Array.from(new Set(candidates.map((p) => p.replaceAll('\\', '/'))))

  if (uniqueCandidates.length === 1) {
    return uniqueCandidates[0]
  }

  if (uniqueCandidates.length > 1) {
    const targetContext = contextPath ? toNormalizedRelative(normRoot, contextPath) : ''
    let bestCandidate = uniqueCandidates[0]
    let bestScore = -1

    for (const cand of uniqueCandidates) {
      const relCand = toNormalizedRelative(normRoot, cand)
      const score = commonPrefixSegments(targetContext, relCand)
      if (score > bestScore) {
        bestScore = score
        bestCandidate = cand
      }
    }
    return bestCandidate
  }

  // Fallback: If no candidate exists, determine where to create one.
  if (contextPath) {
    const rel = toNormalizedRelative(normRoot, contextPath)
    const parts = rel.split('/')
    if (parts.length > 2 && parts[0] === 'draft') {
      const subprojectDir = `${normRoot}/Draft/${parts[1]}`
      try {
        if (await exists(subprojectDir)) {
          return `${subprojectDir}/References.md`
        }
      } catch {
        // ignore
      }
    }
  }

  return `${normRoot}/Draft/References.md`
}

/**
 * Generates the in-text citation string to insert into the Draft editor.
 * Pure function: decoupled from bibliography file generation.
 */
export function insertQuote(quote: Quote, style?: CitationStyle): string {
  return CitationFormatter.formatInline(quote, style ?? quote.quoteType ?? 'APA')
}

/** Legacy alias for backwards compatibility */
export function formatQuoteMarkdown(quote: Quote, referenceNumber?: number): string {
  const copy = { ...quote, refIndex: referenceNumber ?? quote.refIndex ?? 1 }
  return insertQuote(copy)
}

/** Legacy alias for backwards compatibility */
export function formatReferenceEntry(number: number, quote: Quote): string {
  const copy = { ...quote, refIndex: number }
  return CitationFormatter.formatBibliography(copy, quote.quoteType ?? 'APA')
}

let referencesWriteQueue: Promise<unknown> = Promise.resolve()

/**
 * Synchronizes the bibliography file (Draft/References.md) for direct quotes.
 * Serialized via referencesWriteQueue to prevent file race conditions.
 */
export function syncReferences(root: string, quote: Quote): Promise<{ targetPath: string; refIndex: number }> {
  const task = referencesWriteQueue.then(() => doSyncReferences(root, quote))
  referencesWriteQueue = task.catch(() => {})
  return task
}

async function doSyncReferences(root: string, quote: Quote): Promise<{ targetPath: string; refIndex: number }> {
  const targetPath = await findReferencesFile(root, quote.sourcePath)
  const style = quote.quoteType ?? 'APA'
  const isNumeric = style === 'IEEE' || style === 'Chicago'

  let refIndex = quote.refIndex ?? quote.referenceNumber ?? 0
  const authorTrimmed = (quote.authorLastName || quote.author || '').trim()
  const titleTrimmed = (quote.title || '').trim()
  const textTrimmed = (quote.quoteText || quote.text || '').trim()

  // Guard: If empty draft quote, don't pollute References.md
  if (!authorTrimmed && !titleTrimmed && !textTrimmed) {
    return { targetPath, refIndex: refIndex || 1 }
  }

  let currentBody = ''
  let currentFrontmatter = { title: 'References', pageSize: 'a4', columns: 1, theme: 'modern' }

  try {
    const fileExists = await exists(targetPath).catch(() => false)
    if (fileExists) {
      const content = await readTextFile(targetPath)
      const parsed = parseDocument(content)
      currentBody = parsed.body
      currentFrontmatter = { ...currentFrontmatter, ...parsed.frontmatter }

      let lines = currentBody.split('\n')

      // Clean up orphaned dummy lines from accidental keystroke writes
      lines = lines.filter(l => {
        const trimmed = l.trim()
        if (/^\[?Autor Desconocido\]? \(\d{4}\)\. \*?Untitled\*?\.$/i.test(trimmed)) return false
        if (/^[a-z]{1,4} \(\d{4}\)\. \*?Untitled\*?\.$/i.test(trimmed)) return false
        return true
      })

      let maxNum = 0
      let tagLineIndex = -1
      let existingLineIndex = -1

      const citeTag = `<!-- cite:${quote.id} -->`
      const authorKey = authorTrimmed.toLowerCase()
      const titleKey = titleTrimmed.toLowerCase()

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim()
        const lower = line.toLowerCase()

        if (line === citeTag || line.includes(`cite:${quote.id}`)) {
          tagLineIndex = i
          if (i + 1 < lines.length && lines[i + 1].trim()) {
            existingLineIndex = i + 1
          } else {
            existingLineIndex = i
          }
          break
        }

        if (isNumeric) {
          const matchNum = /^\[?(\d+)\]?[\.\s]+(.+)$/.exec(line)
          if (matchNum) {
            const num = parseInt(matchNum[1], 10)
            if (num > maxNum) maxNum = num
            const rest = matchNum[2].toLowerCase()
            if (authorKey && rest.includes(authorKey)) {
              refIndex = num
              existingLineIndex = i
            } else if (refIndex && num === refIndex) {
              existingLineIndex = i
            }
          }
        } else {
          if (authorKey.length >= 3 && lower.includes(authorKey)) {
            existingLineIndex = i
          } else if (titleKey.length >= 3 && lower.includes(titleKey)) {
            existingLineIndex = i
          }
        }
      }

      if (isNumeric && !refIndex) {
        refIndex = maxNum + 1
      }
      if (!refIndex) refIndex = 1

      const updatedQuote = { ...quote, refIndex, referenceNumber: refIndex }
      const newEntry = CitationFormatter.formatBibliography(updatedQuote, style)

      if (tagLineIndex !== -1) {
        if (tagLineIndex === existingLineIndex) {
          lines[tagLineIndex] = `${citeTag}\n${newEntry}`
        } else {
          lines[existingLineIndex] = newEntry
        }
      } else if (existingLineIndex !== -1) {
        lines[existingLineIndex] = `${citeTag}\n${newEntry}`
      } else {
        lines.push('', citeTag, newEntry)
      }

      const updatedBody = lines.join('\n')
      const serialized = serializeDocument(currentFrontmatter, updatedBody)
      await writeTextFile(targetPath, serialized)
      try {
        useDocumentStore.getState().setRawForPath(targetPath, serialized)
      } catch {
        // ignore
      }
    } else {
      if (!refIndex) refIndex = 1
      const updatedQuote = { ...quote, refIndex, referenceNumber: refIndex }
      const newEntry = CitationFormatter.formatBibliography(updatedQuote, style)
      const citeTag = `<!-- cite:${quote.id} -->`
      const initialContent = serializeDocument(currentFrontmatter, `# References\n\n${citeTag}\n${newEntry}\n`)
      await writeTextFile(targetPath, initialContent)
      try {
        useDocumentStore.getState().setRawForPath(targetPath, initialContent)
      } catch {
        // ignore
      }
    }

    useQuotes.getState().update(quote.id, { refIndex, referenceNumber: refIndex })
  } catch (err) {
    console.warn('Could not update References.md:', err)
    if (!refIndex) refIndex = 1
  }

  return { targetPath, refIndex }
}

/**
 * Synchronizes an indirect reference item with Draft/References.md.
 * Serialized via referencesWriteQueue to eliminate race conditions.
 * Uses exact <!-- cite:id --> tracking to prevent duplicate lines.
 */
export function syncReferenceItem(root: string, refItem: ReferenceItem): Promise<{ targetPath: string; refIndex: number }> {
  const task = referencesWriteQueue.then(() => doSyncReferenceItem(root, refItem))
  referencesWriteQueue = task.catch(() => {})
  return task
}

async function doSyncReferenceItem(root: string, refItem: ReferenceItem): Promise<{ targetPath: string; refIndex: number }> {
  const targetPath = await findReferencesFile(root)
  const style = refItem.style ?? 'APA'
  const isNumeric = style === 'IEEE' || style === 'Chicago'

  let refIndex = refItem.refIndex ?? 0
  const authorsTrimmed = (refItem.authors || '').trim()
  const titleTrimmed = (refItem.title || '').trim()

  // Guard: If both authors and title are empty, do not pollute References.md
  if (!authorsTrimmed && !titleTrimmed) {
    return { targetPath, refIndex: refIndex || 1 }
  }

  let currentBody = ''
  let currentFrontmatter = { title: 'References', pageSize: 'a4', columns: 1, theme: 'modern' }

  try {
    const fileExists = await exists(targetPath).catch(() => false)
    if (fileExists) {
      const content = await readTextFile(targetPath)
      const parsed = parseDocument(content)
      currentBody = parsed.body
      currentFrontmatter = { ...currentFrontmatter, ...parsed.frontmatter }

      let lines = currentBody.split('\n')

      // Clean up orphaned dummy lines from accidental keystroke writes
      lines = lines.filter(l => {
        const trimmed = l.trim()
        if (/^\[?Autor Desconocido\]? \(\d{4}\)\. \*?Untitled\*?\.$/i.test(trimmed)) return false
        if (/^[a-z]{1,4} \(\d{4}\)\. \*?Untitled\*?\.$/i.test(trimmed)) return false
        return true
      })

      let maxNum = 0
      let tagLineIndex = -1
      let existingLineIndex = -1

      const citeTag = `<!-- cite:${refItem.id} -->`
      const doiKey = (refItem.doiOrUrl || '').trim().toLowerCase()
      const titleKey = titleTrimmed.toLowerCase()
      const authorKey = authorsTrimmed.toLowerCase()

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim()
        const lower = line.toLowerCase()

        if (line === citeTag || line.includes(`cite:${refItem.id}`)) {
          tagLineIndex = i
          if (i + 1 < lines.length && lines[i + 1].trim()) {
            existingLineIndex = i + 1
          } else {
            existingLineIndex = i
          }
          break
        }

        if (isNumeric) {
          const matchNum = /^\[?(\d+)\]?[\.\s]+(.+)$/.exec(line)
          if (matchNum) {
            const num = parseInt(matchNum[1], 10)
            if (num > maxNum) maxNum = num
            if ((doiKey && lower.includes(doiKey)) || (titleKey.length >= 3 && lower.includes(titleKey))) {
              refIndex = num
              existingLineIndex = i
            } else if (refIndex && num === refIndex) {
              existingLineIndex = i
            }
          }
        } else {
          if (doiKey && lower.includes(doiKey)) {
            existingLineIndex = i
          } else if (titleKey.length >= 3 && lower.includes(titleKey)) {
            existingLineIndex = i
          } else if (authorKey.length >= 3 && lower.includes(authorKey) && refItem.year && lower.includes(refItem.year)) {
            existingLineIndex = i
          }
        }
      }

      if (isNumeric && !refIndex) {
        refIndex = maxNum + 1
      }
      if (!refIndex) refIndex = 1

      const updatedRef = { ...refItem, refIndex }
      const newEntry = CitationFormatter.formatReferenceBibliography(updatedRef, style)

      if (tagLineIndex !== -1) {
        if (tagLineIndex === existingLineIndex) {
          lines[tagLineIndex] = `${citeTag}\n${newEntry}`
        } else {
          lines[existingLineIndex] = newEntry
        }
      } else if (existingLineIndex !== -1) {
        lines[existingLineIndex] = `${citeTag}\n${newEntry}`
      } else {
        lines.push('', citeTag, newEntry)
      }

      const updatedBody = lines.join('\n')
      const serialized = serializeDocument(currentFrontmatter, updatedBody)
      await writeTextFile(targetPath, serialized)
      try {
        useDocumentStore.getState().setRawForPath(targetPath, serialized)
      } catch {
        // ignore
      }
    } else {
      if (!refIndex) refIndex = 1
      const updatedRef = { ...refItem, refIndex }
      const newEntry = CitationFormatter.formatReferenceBibliography(updatedRef, style)
      const citeTag = `<!-- cite:${refItem.id} -->`
      const initialContent = serializeDocument(currentFrontmatter, `# References\n\n${citeTag}\n${newEntry}\n`)
      await writeTextFile(targetPath, initialContent)
      try {
        useDocumentStore.getState().setRawForPath(targetPath, initialContent)
      } catch {
        // ignore
      }
    }

    useQuotes.getState().updateReference(refItem.id, { refIndex })
  } catch (err) {
    console.warn('Could not sync reference in References.md:', err)
    if (!refIndex) refIndex = 1
  }

  return { targetPath, refIndex }
}

/**
 * Inserts an indirect citation at the active editor cursor position and refocuses the editor.
 */
export function handleInsertReferenceCitation(
  refItem: ReferenceItem,
  activeStyle: CitationStyle = refItem.style ?? 'APA'
): { success: boolean; citationText?: string; message?: string } {
  const active = getActiveSnippetDropTarget()
  if (!active) {
    return { success: false, message: 'Open a Draft document to insert the citation.' }
  }

  const citationText = CitationFormatter.formatReferenceInline(refItem, activeStyle)

  if (active.editor && typeof active.editor.chain === 'function') {
    active.editor.chain().focus().insertContent(citationText).run()
  } else if (active.editor && typeof active.editor.commands?.insertContent === 'function') {
    active.editor.commands.insertContent(citationText)
    active.editor.commands.focus()
  }

  return { success: true, citationText, message: `Inserted citation ${citationText}` }
}

/**
 * Ensures that the relevant References.md exists in the project and contains an up-to-date
 * reference entry for this quote. Returns the reference number and the formatted quote Markdown.
 */
export async function ensureReferenceForQuote(root: string, quote: Quote): Promise<ReferenceResult> {
  const { refIndex } = await syncReferences(root, quote)
  const resolved = { ...quote, refIndex, referenceNumber: refIndex }
  return {
    referenceNumber: refIndex,
    quoteMarkdown: insertQuote(resolved),
  }
}
