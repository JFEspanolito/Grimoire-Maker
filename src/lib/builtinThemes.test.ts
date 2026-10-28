import { expect, it } from 'vitest'
import { BUILTIN_THEMES, builtinThemeCss, installBuiltinThemes } from './themes'

it('ships Sci-Fi and the new editorial themes through the same CSS contract as other themes', () => {
  expect(BUILTIN_THEMES).toContainEqual({ id: 'sci-fi', name: 'Sci-Fi', builtin: true })
  expect(BUILTIN_THEMES).toContainEqual({ id: 'modern', name: 'Executive / Modern Doc', builtin: true })
  expect(BUILTIN_THEMES).toContainEqual({ id: 'classic-novel', name: 'Book / Classic Novel', builtin: true })
  expect(BUILTIN_THEMES).toContainEqual({ id: 'minimal-print', name: 'Minimal Monochrome', builtin: true })
  expect(BUILTIN_THEMES).toContainEqual({ id: 'editorial-magazine', name: 'Editorial Magazine', builtin: true })
  expect(BUILTIN_THEMES.some((theme) => theme.id === 'parchment')).toBe(true)
  installBuiltinThemes()
  const css = document.getElementById('grimoire-builtin-themes')?.textContent ?? ''
  expect(css).toContain("[data-theme='sci-fi']")
  expect(css).toContain("[data-theme='classic-novel']")
  expect(css).toContain("[data-theme='minimal-print']")
  expect(css).toContain("[data-theme='editorial-magazine']")
})

it('retains original builtin source without mutating installed styles for the editor', () => {
  installBuiltinThemes()
  const before = document.getElementById('grimoire-builtin-themes')!.textContent
  expect(builtinThemeCss('sci-fi')).toContain('letter-spacing: .08em')
  expect(builtinThemeCss('modern')).toContain('#e1e4e8')
  expect(builtinThemeCss('classic-novel')).toContain('text-indent: 1.25em')
  expect(builtinThemeCss('not-a-theme')).toBeUndefined()
  expect(document.getElementById('grimoire-builtin-themes')!.textContent).toBe(before)
})
