import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { packProject, restoreProject } from './projectArchive'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

describe('project archives', () => {
  beforeEach(() => vi.clearAllMocks())
  it('delegates source and destination selection to native commands', async () => {
    vi.mocked(invoke).mockResolvedValueOnce('/backup.zip').mockResolvedValueOnce('/Restored')
    expect(await packProject()).toBe('/backup.zip')
    expect(await restoreProject()).toBe('/Restored')
    expect(invoke).toHaveBeenNthCalledWith(1, 'pack_project')
    expect(invoke).toHaveBeenNthCalledWith(2, 'restore_project_archive')
  })
  it('preserves cancel and rejection without reporting success', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(null).mockRejectedValueOnce('Unsafe archive')
    expect(await packProject()).toBeNull()
    await expect(restoreProject()).rejects.toBe('Unsafe archive')
  })
})
