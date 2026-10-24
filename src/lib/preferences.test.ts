import { beforeEach, expect, it, vi } from 'vitest'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { changeLibraryPath, loadLibraryPaths, loadSettings, saveSettings } from './preferences'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: vi.fn() }))
vi.mock('@tauri-apps/api/path', () => ({ appConfigDir: async () => 'C:\\Config\\' }))
beforeEach(() => vi.resetAllMocks())

it('resolves browser defaults without restoreSession or invoking native commands', async () => {
  expect(await loadLibraryPaths()).toEqual({ plugins: 'C:/Config/Mods/Plugins', snippets: 'C:/Config/Mods/Snippets', templates: 'C:/Config/Mods/Templates', themes: 'C:/Config/themes' })
  expect(invoke).not.toHaveBeenCalled()
})
it('reloads native persisted preferences on every load, including startup', async () => {
  vi.mocked(isTauri).mockReturnValue(true)
  vi.mocked(invoke).mockResolvedValue({ themes: '/custom/themes' })
  expect(await loadLibraryPaths()).toEqual({ themes: '/custom/themes' })
  expect(invoke).toHaveBeenCalledWith('load_library_paths')
})
it('passes only a category to the native-owned picker and preserves cancellation', async () => {
  vi.mocked(isTauri).mockReturnValue(true)
  vi.mocked(invoke).mockResolvedValue(null)
  expect(await changeLibraryPath('templates')).toBeNull()
  expect(invoke).toHaveBeenCalledWith('change_library_path', { kind: 'templates' })
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
