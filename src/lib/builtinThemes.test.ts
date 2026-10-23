import { expect, it } from 'vitest'
import { BUILTIN_THEMES, installBuiltinThemes } from './themes'

it('ships Sci-Fi through the same CSS contract as other themes', () => {
  expect(BUILTIN_THEMES).toContainEqual({ id: 'sci-fi', name: 'Sci-Fi', builtin: true })
  expect(BUILTIN_THEMES.some((theme) => theme.id === 'parchment')).toBe(true)
  installBuiltinThemes()
  expect(document.getElementById('grimoire-builtin-themes')?.textContent).toContain("[data-theme='sci-fi']")
})
