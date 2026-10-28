import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }))

import { commitProjectReplace, snapshotProjectTexts } from './projectReplace'

describe('projectReplace', () => {
  beforeEach(() => { invoke.mockReset() })

  it('snapshots project texts for the root', async () => {
    invoke.mockResolvedValue([{ path: 'C:/p/a.md', before: 'x' }])
    await expect(snapshotProjectTexts('C:/p')).resolves.toEqual([{ path: 'C:/p/a.md', before: 'x' }])
    expect(invoke).toHaveBeenCalledWith('snapshot_project_texts', { root: 'C:/p' })
  })

  it('commits changes and returns the written paths', async () => {
    const changes = [{ path: 'C:/p/a.md', before: 'x', after: 'y' }]
    invoke.mockResolvedValue(['C:/p/a.md'])
    await expect(commitProjectReplace('C:/p', changes)).resolves.toEqual(['C:/p/a.md'])
    expect(invoke).toHaveBeenCalledWith('commit_project_replace', { root: 'C:/p', changes, knownPaths: null })
  })

  it('forwards the known paths of the snapshot', async () => {
    invoke.mockResolvedValue([])
    await commitProjectReplace('C:/p', [], ['C:/p/a.md'])
    expect(invoke).toHaveBeenCalledWith('commit_project_replace', { root: 'C:/p', changes: [], knownPaths: ['C:/p/a.md'] })
  })

  it('turns rejections into plain errors', async () => {
    invoke.mockImplementation(() => Promise.reject('A document changed since the search: C:/p/a.md. Search again.'))
    const outcome = await commitProjectReplace('C:/p', [{ path: 'a', before: 'x', after: 'y' }]).then(() => 'resolved', (error: Error) => error.message)
    expect(outcome).toBe('A document changed since the search: C:/p/a.md. Search again.')
  })

  it('keeps the message of a rejected snapshot', async () => {
    invoke.mockImplementation(() => Promise.reject(new Error('Markdown inventory exceeds 5000 entries')))
    const outcome = await snapshotProjectTexts('C:/p').then(() => 'resolved', (error: Error) => error.message)
    expect(outcome).toBe('Markdown inventory exceeds 5000 entries')
  })
})
