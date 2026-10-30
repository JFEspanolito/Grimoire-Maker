export type CitationStyle = 'APA' | 'IEEE' | 'MLA' | 'Chicago' | 'Harvard'

export interface CitationMetadata {
  id: string
  refIndex?: number
  quoteText: string
  authorLastName: string
  authorInitial?: string
  year: string | number
  page?: string | number
  title: string
  sourceContainer?: string
  doiOrUrl?: string
  quoteType?: CitationStyle
  sourcePath?: string
  createdAt?: number
}

function resolveAuthor(authorLastName?: string): string {
  const trimmed = (authorLastName ?? '').trim()
  return trimmed.length > 0 ? trimmed : '[Autor Desconocido]'
}

function formatPageLabel(page: string | number, style: CitationStyle): string {
  const p = String(page).trim()
  if (!p) return ''
  const isRange = /[-–—]/.test(p)

  switch (style) {
    case 'APA':
      return isRange ? `pp. ${p}` : `p. ${p}`
    case 'IEEE':
      return isRange ? `pp. ${p}` : `p. ${p}`
    case 'MLA':
      return p
    case 'Harvard':
      return p
    case 'Chicago':
      return p
    default:
      return isRange ? `pp. ${p}` : `p. ${p}`
  }
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

export class CitationFormatter {
  /**
   * Formats the in-text citation for insertion into the document (Draft).
   * Deserializes pure citation grammar without editorial artifacts (no em-dash '—', no mismatched brackets).
   */
  static formatInline(meta: CitationMetadata, style: CitationStyle = meta.quoteType ?? 'APA'): string {
    const author = resolveAuthor(meta.authorLastName)
    const year = meta.year ? String(meta.year).trim() : ''
    const page = meta.page ? String(meta.page).trim() : ''
    const refIndex = meta.refIndex ?? 1
    const text = meta.quoteText.trim()

    switch (style) {
      case 'APA': {
        const pagePart = page ? `, ${formatPageLabel(page, 'APA')}` : ''
        const citation = `(${author}, ${year || 'n.d.'}${pagePart})`

        // Block quote for 40+ words: indented block, no quotation marks, citation at end
        if (wordCount(text) >= 40) {
          return `> ${text}\n>\n> ${citation}\n`
        }
        return `"${text}" ${citation}.`
      }

      case 'IEEE': {
        const pagePart = page ? `, p. ${page}` : ''
        return `"${text}" [${refIndex}${pagePart}].`
      }

      case 'MLA': {
        const pagePart = page ? ` ${page}` : ''
        return `"${text}" (${author}${pagePart}).`
      }

      case 'Chicago': {
        return `"${text}"^[${refIndex}]`
      }

      case 'Harvard': {
        const pagePart = page ? `:${page}` : ''
        const yearPart = year || 'n.d.'
        return `"${text}" (${author} ${yearPart}${pagePart}).`
      }

      default: {
        return `"${text}" (${author}, ${year}).`
      }
    }
  }

  /**
   * Formats the bibliographic entry for References.md.
   * Strictly adheres to each academic standard's structure and sorting convention.
   */
  static formatBibliography(meta: CitationMetadata, style: CitationStyle = meta.quoteType ?? 'APA'): string {
    const author = resolveAuthor(meta.authorLastName)
    const initial = meta.authorInitial?.trim() ? `${meta.authorInitial.trim().replace(/\.$/, '')}.` : ''
    const year = meta.year ? String(meta.year).trim() : 'n.d.'
    const title = meta.title?.trim() || 'Untitled'
    const container = meta.sourceContainer?.trim()
    const doi = meta.doiOrUrl?.trim()
    const page = meta.page ? String(meta.page).trim() : ''
    const refIndex = meta.refIndex ?? 1

    switch (style) {
      case 'APA': {
        // [authorLastName], [authorInitial]. ([year]). *[title]*. [sourceContainer]. [doiOrUrl]
        const authorPart = initial ? `${author}, ${initial}` : author
        const containerPart = container ? ` ${container}.` : ''
        const doiPart = doi ? ` ${doi}` : ''
        return `${authorPart} (${year}). *${title}*.${containerPart}${doiPart}`
      }

      case 'IEEE': {
        // [[refIndex]] [authorInitial]. [authorLastName], *[title]*. [sourceContainer], [year], p. [page]. [doiOrUrl]
        const authorPart = initial ? `${initial} ${author}` : author
        const containerPart = container ? ` ${container},` : ''
        const pagePart = page ? `, ${formatPageLabel(page, 'IEEE')}` : ''
        const doiPart = doi ? ` ${doi}` : ''
        return `[${refIndex}] ${authorPart}, *${title}*.${containerPart} ${year}${pagePart}.${doiPart}`
      }

      case 'MLA': {
        // [authorLastName], [authorInitial]. *[title]*. [sourceContainer], [year]. [doiOrUrl]
        const authorPart = initial ? `${author}, ${initial}` : author
        const dot = authorPart.endsWith('.') ? '' : '.'
        const containerPart = container ? ` ${container},` : ''
        const doiPart = doi ? ` ${doi}` : ''
        return `${authorPart}${dot} *${title}*.${containerPart} ${year}.${doiPart}`
      }

      case 'Chicago': {
        // [refIndex]. [authorInitial] [authorLastName], *[title]* ([sourceContainer], [year]), [page]. [doiOrUrl]
        const authorPart = initial ? `${initial} ${author}` : author
        const innerPub = [container, year].filter(Boolean).join(', ')
        const pubPart = innerPub ? ` (${innerPub})` : ''
        const pagePart = page ? `, ${page}` : ''
        const doiPart = doi ? ` ${doi}` : ''
        return `${refIndex}. ${authorPart}, *${title}*${pubPart}${pagePart}.${doiPart}`
      }

      case 'Harvard': {
        // [authorLastName], [authorInitial]. ([year]) *[title]*. [sourceContainer]. [doiOrUrl]
        const authorPart = initial ? `${author}, ${initial}` : author
        const containerPart = container ? ` ${container}.` : ''
        const doiPart = doi ? ` ${doi}` : ''
        return `${authorPart} (${year}) *${title}*.${containerPart}${doiPart}`
      }

      default: {
        return `${author} (${year}). *${title}*.`
      }
    }
  }
}
