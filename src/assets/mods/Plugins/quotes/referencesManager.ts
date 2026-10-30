import { exists, readDir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { serializeDocument, parseDocument } from '../../../../lib/frontmatter'
import { useDocumentStore } from '../../../../stores/documentStore'
import type { FileNode } from '../../../../types/document'
import type { Quote } from './quotesStore'
import { useQuotes } from './quotesStore'

export interface ReferenceResult {
  referenceNumber: number
  quoteMarkdown: string
}

const DEFAULT_REFERENCES_HEADER = `---
title: References
pageSize: a4
columns: 1
theme: modern
---
# References

`

/** Formats a single bibliographic reference entry according to academic conventions. */
export function formatReferenceEntry(number: number, quote: Quote): string {
  const author = quote.author?.trim() || quote.title?.trim() || 'Anonymous'
  const year = quote.year?.trim() || 'n.d.'
  const title = quote.title?.trim() || 'Untitled'
  const page = quote.page?.trim()
  const type = quote.quoteType || 'APA'

  switch (type) {
    case 'MLA': {
      const pagePart = page ? `, p. ${page}` : ''
      return `${number}. ${author}. *${title}*. ${year}${pagePart}.`
    }
    case 'Chicago': {
      const pagePart = page ? `, ${page}` : ''
      return `${number}. ${author}. ${year}. *${title}*${pagePart}.`
    }
    case 'Harvard': {
      const pagePart = page ? `, p. ${page}` : ''
      return `${number}. ${author}, ${year}. *${title}*${pagePart}.`
    }
    case 'IEEE': {
      const pagePart = page ? `, p. ${page}` : ''
      return `${number}. ${author}, "${title}", ${year}${pagePart}.`
    }
    case 'ASC': {
      const pagePart = page ? `, p ${page}` : ''
      return `${number}. ${author}. *${title}*; ${year}${pagePart}.`
    }
    case 'APA':
    default: {
      const pagePart = page ? `, p. ${page}` : ''
      return `${number}. ${author} (${year}). *${title}*${pagePart}.`
    }
  }
}

/** Formats the blockquote to be inserted into the manuscript. */
export function formatQuoteMarkdown(quote: Quote, referenceNumber: number): string {
  const author = quote.author?.trim() || quote.title?.trim() || 'Anonymous'
  const year = quote.year?.trim()
  const page = quote.page?.trim()
  const type = quote.quoteType || 'APA'

  switch (type) {
    case 'MLA': {
      const cite = page ? `(${author} ${page})` : `(${author})`
      return `> "${quote.text}"\n> — ${cite} [[${referenceNumber}]]\n`
    }
    case 'Chicago': {
      const pagePart = page ? `, ${page}` : ''
      const yearPart = year ? ` ${year}` : ''
      return `> "${quote.text}"\n> — (${author}${yearPart}${pagePart}) [[${referenceNumber}]]\n`
    }
    case 'Harvard': {
      const yearPart = year ? `, ${year}` : ''
      const pagePart = page ? `: ${page}` : ''
      return `> "${quote.text}"\n> — (${author}${yearPart}${pagePart}) [[${referenceNumber}]]\n`
    }
    case 'IEEE':
    case 'ASC': {
      return `> "${quote.text}" [${referenceNumber}]\n`
    }
    case 'APA':
    default: {
      const yearPart = year ? `, ${year}` : ''
      const pagePart = page ? `, p. ${page}` : ''
      return `> "${quote.text}"\n> — (${author}${yearPart}${pagePart}) [[${referenceNumber}]]\n`
    }
  }
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
 * Ensures that the relevant References.md exists in the project and contains an up-to-date
 * reference entry for this quote. Returns the reference number and the formatted quote Markdown.
 */
export async function ensureReferenceForQuote(root: string, quote: Quote): Promise<ReferenceResult> {
  const targetPath = await findReferencesFile(root, quote.sourcePath)
  let referenceNumber = quote.referenceNumber ?? 0
  let currentBody = ''
  let currentFrontmatter = { title: 'References', pageSize: 'a4', columns: 1, theme: 'modern' }

  try {
    const fileExists = await exists(targetPath).catch(() => false)
    if (fileExists) {
      const content = await readTextFile(targetPath)
      const parsed = parseDocument(content)
      currentBody = parsed.body
      currentFrontmatter = { ...currentFrontmatter, ...parsed.frontmatter }

      const lines = currentBody.split('\n')
      let maxNum = 0
      let existingLineIndex = -1

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim()
        const match = /^(\d+)\.\s*(.+)$/.exec(line)
        if (match) {
          const num = parseInt(match[1], 10)
          if (num > maxNum) maxNum = num
          const rest = match[2].toLowerCase()
          const keyAuthor = (quote.author || quote.title || '').trim().toLowerCase()
          if (keyAuthor && rest.includes(keyAuthor)) {
            referenceNumber = num
            existingLineIndex = i
          } else if (referenceNumber && num === referenceNumber) {
            existingLineIndex = i
          }
        }
      }

      if (existingLineIndex !== -1 && referenceNumber > 0) {
        // Update existing entry with latest metadata/style
        lines[existingLineIndex] = formatReferenceEntry(referenceNumber, quote)
        const updatedBody = lines.join('\n')
        const serialized = serializeDocument(currentFrontmatter, updatedBody)
        await writeTextFile(targetPath, serialized)
        try {
          useDocumentStore.getState().setRawForPath(targetPath, serialized)
        } catch {
          // ignore
        }
      } else {
        referenceNumber = maxNum + 1
        const newEntry = formatReferenceEntry(referenceNumber, quote)
        const updatedBody = currentBody.trimEnd() ? `${currentBody.trimEnd()}\n\n${newEntry}\n` : `${newEntry}\n`
        const serialized = serializeDocument(currentFrontmatter, updatedBody)
        await writeTextFile(targetPath, serialized)
        try {
          useDocumentStore.getState().setRawForPath(targetPath, serialized)
        } catch {
          // ignore
        }
      }
    } else {
      referenceNumber = 1
      const newEntry = formatReferenceEntry(referenceNumber, quote)
      const initialContent = serializeDocument(currentFrontmatter, `# References\n\n${newEntry}\n`)
      await writeTextFile(targetPath, initialContent)
      try {
        useDocumentStore.getState().setRawForPath(targetPath, initialContent)
      } catch {
        // ignore
      }
    }

    useQuotes.getState().update(quote.id, { referenceNumber })
  } catch (err) {
    console.warn('Could not update References.md:', err)
    if (!referenceNumber) referenceNumber = 1
  }

  return {
    referenceNumber,
    quoteMarkdown: formatQuoteMarkdown(quote, referenceNumber),
  }
}
