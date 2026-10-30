import { exists, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { serializeDocument, parseDocument } from '../../../../lib/frontmatter'
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

/**
 * Ensures that Draft/References.md exists in the project and contains a numbered reference entry
 * for this quote. Returns the reference number and the formatted quote Markdown ready to insert.
 */
export async function ensureReferenceForQuote(root: string, quote: Quote): Promise<ReferenceResult> {
  const targetPath = `${root.replaceAll('\\', '/').replace(/\/+$/, '')}/Draft/References.md`
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

      // Check if reference already exists matching author and title
      const lines = currentBody.split('\n')
      let maxNum = 0

      for (const line of lines) {
        const match = /^(\d+)\.\s*(.+)$/.exec(line.trim())
        if (match) {
          const num = parseInt(match[1], 10)
          if (num > maxNum) maxNum = num
          const rest = match[2].toLowerCase()
          const keyAuthor = (quote.author || quote.title || '').toLowerCase()
          if (keyAuthor && rest.includes(keyAuthor)) {
            // Already present, reuse number
            referenceNumber = num
          }
        }
      }

      if (!referenceNumber) {
        referenceNumber = maxNum + 1
        const newEntry = formatReferenceEntry(referenceNumber, quote)
        const updatedBody = currentBody.trimEnd() + `\n${newEntry}\n`
        await writeTextFile(targetPath, serializeDocument(currentFrontmatter, updatedBody))
      }
    } else {
      referenceNumber = 1
      const newEntry = formatReferenceEntry(referenceNumber, quote)
      const initialContent = serializeDocument(currentFrontmatter, `# References\n\n${newEntry}\n`)
      await writeTextFile(targetPath, initialContent)
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
