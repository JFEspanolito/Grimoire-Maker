import { expect, it } from 'vitest'
import { BUILTIN_THEMES, builtinThemeCss, installBuiltinThemes } from './themes'

it('ships Sci-Fi through the same CSS contract as other themes', () => {
  expect(BUILTIN_THEMES).toContainEqual({ id: 'sci-fi', name: 'Sci-Fi', builtin: true })
  expect(BUILTIN_THEMES.some((theme) => theme.id === 'parchment')).toBe(true)
  installBuiltinThemes()
  expect(document.getElementById('grimoire-builtin-themes')?.textContent).toContain("[data-theme='sci-fi']")
})

it('retains original builtin source without mutating installed styles for the editor', () => {
  installBuiltinThemes()
  const before = document.getElementById('grimoire-builtin-themes')!.textContent
  expect(builtinThemeCss('sci-fi')).toContain('letter-spacing: .08em')
  expect(builtinThemeCss('not-a-theme')).toBeUndefined()
  expect(document.getElementById('grimoire-builtin-themes')!.textContent).toBe(before)
})
