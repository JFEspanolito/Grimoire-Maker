import { beforeEach, expect, it, vi } from 'vitest'
import { BUILTIN_THEMES, builtinThemeCss, loadUserThemes } from './themes'
import { useThemeStore } from '../stores/themeStore'
import { loadThemeDraft } from './themeEditor'

const disk = vi.hoisted(() => new Map<string, string>())
const write = vi.hoisted(() => vi.fn(async (path: string, text: string, options: { createNew?: boolean }) => {
  if (!options?.createNew || disk.has(path)) throw new Error('File already exists')
  disk.set(path, text)
}))
vi.mock('./preferences', () => ({ loadLibraryPaths: async () => ({ themes: '/themes', templates: '/templates' }) }))
vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: async (path: string) => path === '/themes' || disk.has(path), mkdir: vi.fn(), stat: vi.fn(async () => ({ size: 10 })),
  writeTextFile: write, rename: vi.fn(),
  readTextFile: async (path: string) => { if (!disk.has(path)) throw new Error('Missing file'); return disk.get(path)! },
  readDir: async () => [...disk.keys()].filter(path => path.startsWith('/themes/')).map(path => ({ name: path.slice(8), isFile: true, isSymlink: false, isDirectory: false })),
}))
beforeEach(() => { disk.clear(); write.mockClear() })

it('installs editable builtin examples without overwriting existing themes or duplicating catalog entries', async () => {
  const custom = "/* @name: My Parchment */ [data-theme='parchment'] { --page-bg: #123456; }"
  disk.set('/themes/parchment.css', custom)
  await useThemeStore.getState().reload()
  for (const theme of BUILTIN_THEMES) expect(disk.get(`/themes/${theme.id}.css`)).toContain(`[data-theme='${theme.id}']`)
  expect(disk.get('/themes/parchment.css')).toBe(custom)
  expect(disk.get('/themes/README.md')).toContain('data-theme')
  expect(useThemeStore.getState().themes.filter(theme => theme.id === 'parchment')).toEqual([{ id: 'parchment', name: 'My Parchment', builtin: false }])
  expect(useThemeStore.getState().errors).toEqual([])
  const draft = await loadThemeDraft({ id: 'parchment', name: 'My Parchment', builtin: false }, true)
  expect(draft.path).toBe('/themes/parchment.css')
  expect(draft.css).toBe(custom)
  expect(document.getElementById('grimoire-builtin-themes')?.textContent).not.toContain("[data-theme='parchment']")
  expect(builtinThemeCss('parchment')).not.toBe(custom)
})

it('seeds once and retains the embedded fallback if an example is deleted or invalid', async () => {
  await loadUserThemes()
  disk.delete('/themes/parchment.css')
  disk.set('/themes/modern.css', 'invalid theme')
  write.mockClear()
  const result = await loadUserThemes()
  expect(write).not.toHaveBeenCalled()
  expect(disk.has('/themes/parchment.css')).toBe(false)
  expect(result.errors).toHaveLength(1)
  expect(document.getElementById('grimoire-builtin-themes')?.textContent).toContain("[data-theme='parchment']")
  expect(document.getElementById('grimoire-builtin-themes')?.textContent).toContain("[data-theme='modern']")
  disk.set('/themes/modern.css', "/* @name: Recovered Modern */ [data-theme='modern'] { --page-bg: #abcdef; }")
  await useThemeStore.getState().reload()
  expect(useThemeStore.getState().themes.filter(theme => theme.id === 'modern')).toEqual([{ id: 'modern', name: 'Recovered Modern', builtin: false }])
  expect(document.getElementById('grimoire-builtin-themes')?.textContent).not.toContain("[data-theme='modern']")
  expect(document.getElementById('grimoire-user-themes')?.textContent).toContain('#abcdef')
  expect(write).not.toHaveBeenCalled()
})
