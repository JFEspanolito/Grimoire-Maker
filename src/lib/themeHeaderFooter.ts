import type { CSSProperties } from 'react'

export const PAGE_TEXT_AREAS = ['header', 'footer'] as const
export const PAGE_TEXT_POSITIONS = ['left', 'center', 'right'] as const
export const DIVIDER_SIDES = ['top', 'bottom', 'left', 'right'] as const
export type DividerSides = Record<(typeof DIVIDER_SIDES)[number], boolean>
export interface HeaderFooterDivider { header: DividerSides; footer: DividerSides; color: string }
export type PageTextArea = (typeof PAGE_TEXT_AREAS)[number]
export type PageTextPosition = (typeof PAGE_TEXT_POSITIONS)[number]
export type PageTextSlots = Record<PageTextPosition, string>
export interface ThemeHeaderFooter { header: PageTextSlots; footer: PageTextSlots; divider?: HeaderFooterDivider }
export interface PageTextContext { book?: string; title?: string; author?: string; coAuthor?: string; page: number; pages: number }
export const PAGE_TEXT_TOKENS = { '{book}': 'Book name', '{title}': 'Document title', '{author}': 'Author', '{coAuthor}': 'Co-Author', '{page}': 'Page number', '{pages}': 'Total pages' } as const
const BLOCK = /\/\* grimoire-header-footer:start ([^\r\n]*?) \*\/[\s\S]*?\/\* grimoire-header-footer:end \*\//g

export const emptyDivider = (): HeaderFooterDivider => ({
  header: { top: false, bottom: false, left: false, right: false },
  footer: { top: false, bottom: false, left: false, right: false }, color: '#bda675',
})
export const emptyHeaderFooter = (): ThemeHeaderFooter => ({ header: { left: '', center: '', right: '' }, footer: { left: '', center: '', right: '' }, divider: { ...emptyDivider(), header: { top: false, bottom: true, left: false, right: false } } })

/** Shared by the customization preview, canvas and serialized PDF pages. */
export function dividerStyle(layout: ThemeHeaderFooter, area: PageTextArea): CSSProperties {
  const divider = layout.divider
  if (!divider) return {}
  return {
    boxSizing: 'border-box',
    ...Object.fromEntries(DIVIDER_SIDES.map(side => [
      `border${side[0].toUpperCase()}${side.slice(1)}`,
      divider[area][side] ? `1px solid ${divider.color}` : 'none',
    ])),
  }
}

function validate(value: unknown): ThemeHeaderFooter {
  if (!value || typeof value !== 'object') throw new Error('Invalid header/footer settings.')
  const result: ThemeHeaderFooter = { header: { left: '', center: '', right: '' }, footer: { left: '', center: '', right: '' } }
  for (const area of PAGE_TEXT_AREAS) {
    const slots = (value as Record<string, unknown>)[area]
    if (!slots || typeof slots !== 'object') throw new Error('Invalid header/footer slots.')
    for (const position of PAGE_TEXT_POSITIONS) {
      const text = (slots as Record<string, unknown>)[position]
      if (typeof text !== 'string' || text.length > 500) throw new Error('Header/footer text must contain at most 500 characters per slot.')
      result[area][position] = text
    }
  }
  const divider = (value as Record<string, unknown>).divider
  if (divider !== undefined) {
    if (!divider || typeof divider !== 'object' || Array.isArray(divider)) throw new Error('Invalid divider settings.')
    const raw = divider as Record<string, unknown>
    const parsed = emptyDivider()
    // Accept the original flat divider draft as header borders only.
    const legacy = raw.header === undefined && raw.footer === undefined
    for (const area of PAGE_TEXT_AREAS) {
      if (legacy && area === 'footer') continue
      const sides = legacy ? raw : raw[area]
      if (!sides || typeof sides !== 'object') throw new Error('Invalid divider sides.')
      for (const side of DIVIDER_SIDES) {
        const enabled = (sides as Record<string, unknown>)[side]
        if (typeof enabled !== 'boolean') throw new Error('Divider sides must be true or false.')
        parsed[area][side] = enabled
      }
    }
    if (!legacy || raw.color !== undefined) {
      if (typeof raw.color !== 'string' || !/^#[\da-f]{6}$/i.test(raw.color)) throw new Error('Divider color must be a six-digit hex color.')
      parsed.color = raw.color
    }
    result.divider = parsed
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
  return !!value && PAGE_TEXT_AREAS.some(area => PAGE_TEXT_POSITIONS.some(position => value[area][position].trim())
    || DIVIDER_SIDES.some(side => value.divider?.[area][side]))
}
