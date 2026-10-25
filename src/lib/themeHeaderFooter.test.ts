import { expect, it } from 'vitest'
import { encodeHeaderFooter, readThemeHeaderFooter, resolvePageText } from './themeHeaderFooter'
import { buildThemeCss, themeColors } from './themeEditor'
const layout = { header: { left: '', center: '{book}', right: '' }, footer: { left: '{author}', center: '', right: 'Page {page} of {pages}' } }
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
