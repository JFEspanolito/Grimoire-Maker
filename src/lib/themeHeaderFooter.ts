export const PAGE_TEXT_AREAS = ['header', 'footer'] as const
export const PAGE_TEXT_POSITIONS = ['left', 'center', 'right'] as const
export type PageTextArea = (typeof PAGE_TEXT_AREAS)[number]
export type PageTextPosition = (typeof PAGE_TEXT_POSITIONS)[number]
export type PageTextSlots = Record<PageTextPosition, string>
export interface ThemeHeaderFooter { header: PageTextSlots; footer: PageTextSlots }
export interface PageTextContext { book?: string; title?: string; author?: string; coAuthor?: string; page: number; pages: number }
export const PAGE_TEXT_TOKENS = { '{book}': 'Book name', '{title}': 'Document title', '{author}': 'Author', '{coAuthor}': 'Co-Author', '{page}': 'Page number', '{pages}': 'Total pages' } as const
const BLOCK = /\/\* grimoire-header-footer:start ([^\r\n]*?) \*\/[\s\S]*?\/\* grimoire-header-footer:end \*\//g

export const emptyHeaderFooter = (): ThemeHeaderFooter => ({ header: { left: '', center: '', right: '' }, footer: { left: '', center: '', right: '' } })

function validate(value: unknown): ThemeHeaderFooter {
  if (!value || typeof value !== 'object') throw new Error('Invalid header/footer settings.')
  const result = emptyHeaderFooter()
  for (const area of PAGE_TEXT_AREAS) {
    const slots = (value as Record<string, unknown>)[area]
    if (!slots || typeof slots !== 'object') throw new Error('Invalid header/footer slots.')
    for (const position of PAGE_TEXT_POSITIONS) {
      const text = (slots as Record<string, unknown>)[position]
      if (typeof text !== 'string' || text.length > 500) throw new Error('Header/footer text must contain at most 500 characters per slot.')
      result[area][position] = text
    }
  }
  return result
}

export function readThemeHeaderFooter(css: string): ThemeHeaderFooter | undefined {
  const block = [...css.matchAll(BLOCK)].at(-1)
  if (!block) {
    if (css.includes('/* grimoire-header-footer:start')) throw new Error('The theme header/footer metadata is damaged.')
    return undefined
  }
  return validate(JSON.parse(decodeURIComponent(block[1])))
}

export function stripHeaderFooter(css: string): string { return css.replace(BLOCK, '') }

export function encodeHeaderFooter(value: ThemeHeaderFooter | undefined): string {
  if (!value) return ''
  return `/* grimoire-header-footer:start ${encodeURIComponent(JSON.stringify(validate(value)))} */\n/* grimoire-header-footer:end */`
}

export function resolvePageText(text: string, context: PageTextContext): string {
  return text.replace(/\{(book|title|author|coAuthor|page|pages)\}/g, (_match, token: keyof PageTextContext) => String(context[token] ?? ''))
}

export function bookName(path: string | null): string { return path?.replaceAll('\\', '/').replace(/\/$/, '').split('/').at(-1) ?? '' }

export function hasPageText(value: ThemeHeaderFooter | undefined): value is ThemeHeaderFooter {
  return !!value && PAGE_TEXT_AREAS.some(area => PAGE_TEXT_POSITIONS.some(position => value[area][position].trim()))
}
