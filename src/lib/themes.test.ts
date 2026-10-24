import { beforeEach, expect, it, vi } from 'vitest'
import { exists, readDir, readTextFile } from '@tauri-apps/plugin-fs'
import { loadLibraryPaths } from './preferences'
import { loadUserThemes } from './themes'

vi.mock('./preferences', () => ({ loadLibraryPaths: vi.fn() }))
vi.mock('@tauri-apps/plugin-fs', () => ({ exists: vi.fn(), mkdir: vi.fn(), readDir: vi.fn(), readTextFile: vi.fn() }))
beforeEach(() => vi.resetAllMocks())
it('loads the configured CSS directory and rejects linked files', async () => {
  vi.mocked(loadLibraryPaths).mockResolvedValue({ plugins: '/plugins', snippets: '/snippets', templates: '/templates', themes: '/custom/themes' })
  vi.mocked(exists).mockResolvedValue(true)
  vi.mocked(readDir).mockResolvedValue([
    { name: 'custom.css', isDirectory: false, isFile: true, isSymlink: false },
    { name: 'linked.css', isDirectory: false, isFile: true, isSymlink: true },
  ])
  vi.mocked(readTextFile).mockResolvedValue("/* @name: Custom */ [data-theme='custom'] { color: red }")
  const result = await loadUserThemes()
  expect(readDir).toHaveBeenCalledWith('/custom/themes')
  expect(result.themes).toEqual([{ id: 'custom', name: 'Custom', builtin: false }])
  expect(readTextFile).not.toHaveBeenCalledWith('/custom/themes/linked.css')
})
