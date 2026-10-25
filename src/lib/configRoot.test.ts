import { beforeEach, expect, it, vi } from 'vitest'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { configRoot } from './configRoot'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: vi.fn() }))
vi.mock('@tauri-apps/api/path', () => ({ configDir: vi.fn(async () => 'C:\\Users\\Example\\AppData\\Roaming\\') }))
beforeEach(() => vi.clearAllMocks())

it('requests the prepared native root without renderer path arguments', async () => {
  vi.mocked(isTauri).mockReturnValue(true)
  vi.mocked(invoke).mockResolvedValue('C:/Users/Example/AppData/Roaming/GriomoireMaker')
  expect(await configRoot()).toBe('C:/Users/Example/AppData/Roaming/GriomoireMaker')
  expect(invoke).toHaveBeenCalledExactlyOnceWith('config_root')
})
it('uses the exact requested directory name for browser fallback without invoking migration', async () => {
  vi.mocked(isTauri).mockReturnValue(false)
  expect(await configRoot()).toBe('C:/Users/Example/AppData/Roaming/GriomoireMaker')
  expect(invoke).not.toHaveBeenCalled()
})
it('propagates root-preparation errors instead of falling back to an empty desktop configuration', async () => {
  vi.mocked(isTauri).mockReturnValue(true)
  vi.mocked(invoke).mockRejectedValue(new Error('migration failed'))
  await expect(configRoot()).rejects.toThrow('migration failed')
})
