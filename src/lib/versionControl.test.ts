import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

import { autoCommitChanges, commitChanges, diffChange, getRepositoryStatus, initializeRepository, stageChange, unstageChange } from './versionControl'

describe('local source-control actions', () => {
  beforeEach(() => invoke.mockReset())

  it('runs automatic staging and commit in one native operation and preserves skipped outcomes', async () => {
    invoke.mockResolvedValueOnce('gitUnavailable')
    expect(await autoCommitChanges('C:/Books', 'update content automatically')).toBe('gitUnavailable')
    expect(invoke).toHaveBeenCalledExactlyOnceWith('git_auto_commit', { workspace: 'C:/Books', message: 'update content automatically' })
  })

  it('passes unicode, spaces and rename paths literally to native actions', async () => {
    await stageChange('C:/Books', 'Draft/new résumé.md')
    await unstageChange('C:/Books', 'Draft/new résumé.md')
    await diffChange('C:/Books', 'Draft/new résumé.md', true)
    expect(invoke.mock.calls).toEqual([
      ['git_stage', { workspace: 'C:/Books', path: 'Draft/new résumé.md' }],
      ['git_unstage', { workspace: 'C:/Books', path: 'Draft/new résumé.md' }],
      ['git_diff', { workspace: 'C:/Books', path: 'Draft/new résumé.md', staged: true }],
    ])
  })

  it('commits only through an explicit staged-index fingerprint and preserves errors', async () => {
    invoke.mockRejectedValueOnce(new Error('Identity is missing'))
    await expect(commitChanges('C:/Books', 'Write chapter', 'index-1')).rejects.toThrow('Identity is missing')
    expect(invoke).toHaveBeenCalledWith('git_commit', {
      workspace: 'C:/Books', message: 'Write chapter', expectedIndex: 'index-1',
    })
  })

  it('never initializes implicitly when reading status', async () => {
    await getRepositoryStatus('C:/Books')
    expect(invoke).toHaveBeenCalledExactlyOnceWith('git_status', { workspace: 'C:/Books' })
    await initializeRepository('C:/Books')
    expect(invoke).toHaveBeenLastCalledWith('git_init', { workspace: 'C:/Books' })
  })
})
