import { beforeEach, expect, it, vi } from 'vitest'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { changeLibraryPath, loadLibraryPaths, loadSettings, saveSettings } from './preferences'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: vi.fn() }))
vi.mock('@tauri-apps/api/path', () => ({ configDir: async () => 'C:\\Config\\' }))
beforeEach(() => vi.resetAllMocks())

it('resolves browser defaults without restoreSession or invoking native commands', async () => {
  expect(await loadLibraryPaths()).toEqual({ plugins: 'C:/Config/GriomoireMaker/Mods/Plugins', snippets: 'C:/Config/GriomoireMaker/Mods/Snippets', templates: 'C:/Config/GriomoireMaker/Mods/Templates', themes: 'C:/Config/GriomoireMaker/themes', logs: 'C:/Config/GriomoireMaker/logs' })
  expect(invoke).not.toHaveBeenCalled()
})
it('reloads native persisted preferences on every load, including startup', async () => {
  vi.mocked(isTauri).mockReturnValue(true)
  vi.mocked(invoke).mockResolvedValue({ themes: '/custom/themes' })
  expect(await loadLibraryPaths()).toEqual({ themes: '/custom/themes' })
  expect(invoke).toHaveBeenCalledWith('load_library_paths')
})
it('passes the native managed-folder report through to the library setup', async () => {
  vi.mocked(isTauri).mockReturnValue(true)
  const loaded = { plugins: 'D:/Data/Plugins', snippets: 'D:/Data/Snippets', templates: 'D:/Data/Templates', themes: 'D:/Data/Themes', logs: 'D:/Data/Logs', managed: { plugins: true, snippets: true, templates: true } }
  vi.mocked(invoke).mockResolvedValue(loaded)
  expect(await loadLibraryPaths()).toEqual(loaded)
})
it('keeps the browser fallback on the unchanged normal-mode layout with no managed folders', async () => {
  const paths = await loadLibraryPaths()
  expect(paths).not.toHaveProperty('managed')
  expect(Object.values(paths).every(path => path.startsWith('C:/Config/GriomoireMaker/'))).toBe(true)
  expect([paths.plugins, paths.snippets, paths.templates]).toEqual(['Plugins', 'Snippets', 'Templates'].map(name => `C:/Config/GriomoireMaker/Mods/${name}`))
})
it('passes only a category to the native-owned picker and preserves cancellation', async () => {
  vi.mocked(isTauri).mockReturnValue(true)
  vi.mocked(invoke).mockResolvedValue(null)
  expect(await changeLibraryPath('templates')).toBeNull()
  expect(invoke).toHaveBeenCalledWith('change_library_path', { kind: 'templates' })
})
it('passes only the logs category, never a renderer-selected destination', async () => {
  vi.mocked(isTauri).mockReturnValue(true)
  vi.mocked(invoke).mockResolvedValue(null)
  expect(await changeLibraryPath('logs')).toBeNull()
  expect(invoke).toHaveBeenCalledWith('change_library_path', { kind: 'logs' })
})
it('propagates native copy failures and refuses changes without native selection', async () => {
  await expect(changeLibraryPath('plugins')).rejects.toThrow('desktop')
  vi.mocked(isTauri).mockReturnValue(true)
  vi.mocked(invoke).mockRejectedValue(new Error('collision'))
  await expect(changeLibraryPath('plugins')).rejects.toThrow('collision')
})


it('loads settings from native persistence and serializes consecutive appearance updates', async () => {
  vi.mocked(isTauri).mockReturnValue(true)
  vi.mocked(invoke).mockResolvedValueOnce({ theme: 'sci-fi' })
  expect(await loadSettings()).toEqual({ theme: 'sci-fi' })
  expect(invoke).toHaveBeenCalledWith('load_settings')
  let finish!: () => void
  vi.mocked(invoke).mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
  const first = saveSettings({ theme: 'modern' })
  const second = saveSettings({ theme: 'sci-fi' })
  await Promise.resolve()
  expect(invoke).toHaveBeenCalledTimes(2)
  finish()
  await Promise.all([first, second])
  expect(invoke).toHaveBeenLastCalledWith('save_settings', { settings: { theme: 'sci-fi' } })
})

it('propagates a failed settings save without blocking later saves', async () => {
  vi.mocked(isTauri).mockReturnValue(true)
  vi.mocked(invoke).mockRejectedValueOnce(new Error('disk full')).mockResolvedValueOnce(undefined)
  await expect(saveSettings({ theme: 'modern' })).rejects.toThrow('disk full')
  await expect(saveSettings({ theme: 'sci-fi' })).resolves.toBeUndefined()
})
