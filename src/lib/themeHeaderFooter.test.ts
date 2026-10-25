import { expect, it } from 'vitest'
import { encodeHeaderFooter, readThemeHeaderFooter, resolvePageText } from './themeHeaderFooter'
import { buildThemeCss, themeColors } from './themeEditor'
const layout = { header: { left: '', center: '{book}', right: '' }, footer: { left: '{author}', center: '', right: 'Page {page} of {pages}' } }

it('preserves independent divider sides and a shared color when saving and copying themes', () => {
  const divider = { header: { top: false, bottom: true, left: false, right: true }, footer: { top: true, bottom: false, left: true, right: false }, color: '#abcdef' }
  const configured = { ...layout, divider }
  const source = encodeHeaderFooter(configured)
  expect(readThemeHeaderFooter(source)).toEqual(configured)
  expect(readThemeHeaderFooter(buildThemeCss(source, 'original', 'copy', 'Copy', themeColors(source)))).toEqual(configured)
  expect(() => encodeHeaderFooter({ ...configured, divider: { ...divider, color: 'red; background:url(x)' } })).toThrow()
  expect(() => readThemeHeaderFooter(`/* grimoire-header-footer:start ${encodeURIComponent(JSON.stringify({ ...configured, divider: { ...divider, header: { ...divider.header, top: 'true' } } }))} */\n/* grimoire-header-footer:end */`)).toThrow()
})
it('round-trips editable header/footer metadata and preserves it when copying themes', () => {
  const source = "[data-theme='original'] { font-family: Georgia; }" + encodeHeaderFooter(layout)
  const copy = buildThemeCss(source, 'original', 'copy', 'Copy', themeColors(source))
  expect(readThemeHeaderFooter(copy)).toEqual(layout)
  expect(copy).toContain('font-family: Georgia')
  expect(readThemeHeaderFooter('')).toBeUndefined()
})
it('keeps text inert, validates metadata, and replaces tokens without recursively interpreting values', () => {
  const unsafe = { ...layout, header: { ...layout.header, left: '</style><script>alert(1)</script> */' } }
  const encoded = encodeHeaderFooter(unsafe)
  expect(encoded).not.toContain('<script>')
  expect(readThemeHeaderFooter(encoded)).toEqual(unsafe)
  expect(resolvePageText('{book} | {author} | Page {page} of {pages}', { book: '{page}', author: '<img>', page: 2, pages: 8 })).toBe('{page} | <img> | Page 2 of 8')
  expect(() => encodeHeaderFooter({ ...layout, footer: { ...layout.footer, right: 'x'.repeat(501) } })).toThrow()
  expect(() => readThemeHeaderFooter('/* grimoire-header-footer:start damaged */')).toThrow()
})

it('resolves the project co-author token', () => {
  expect(resolvePageText('{author} / {coAuthor}', { author: 'Alice', coAuthor: 'Bob', page: 1, pages: 1 })).toBe('Alice / Bob')
})

it('reads the original flat divider draft as header borders without changing old text-only themes', () => {
  const raw = { ...layout, divider: { left: false, top: false, right: false, bottom: true } }
  const css = `/* grimoire-header-footer:start ${encodeURIComponent(JSON.stringify(raw))} */\n/* grimoire-header-footer:end */`
  expect(readThemeHeaderFooter(css)?.divider).toEqual({ header: raw.divider,
    footer: { top: false, bottom: false, left: false, right: false }, color: '#bda675' })
})
