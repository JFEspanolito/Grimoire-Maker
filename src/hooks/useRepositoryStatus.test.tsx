import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useRepositoryStatus } from './useRepositoryStatus'
import { getRepositoryStatus } from '../lib/versionControl'
import { notifyRepositoryChanged } from '../lib/repositoryEvents'
vi.mock('./useFileSystem', () => ({ isTauri: () => true }))
vi.mock('../lib/versionControl', () => ({ getRepositoryStatus: vi.fn() }))
const dirty = { isRepository: true, branch: 'Dev', indexFingerprint: 'a', entries: [{ path: 'a.md', originalPath: null, indexStatus: '?', worktreeStatus: '?' }] }
const clean = { ...dirty, entries: [] }
let current: ReturnType<typeof useRepositoryStatus>
let root: ReturnType<typeof createRoot>
function Harness({ workspace = '/a' }) { current = useRepositoryStatus(workspace); return null }
beforeEach(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  vi.useFakeTimers(); vi.mocked(getRepositoryStatus).mockReset().mockResolvedValue(dirty)
  root = createRoot(document.createElement('div'))
})
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers() })
it('tracks untracked and staged changes while collapsed, then clears after a commit invalidation', async () => {
  await act(async () => root.render(<Harness />))
  expect(current.status?.entries).toHaveLength(1)
  vi.mocked(getRepositoryStatus).mockResolvedValue({ ...dirty, entries: [{ ...dirty.entries[0], indexStatus: 'M', worktreeStatus: ' ' }] })
  await act(async () => vi.advanceTimersByTimeAsync(5000))
  expect(current.status?.entries[0].indexStatus).toBe('M')
  vi.mocked(getRepositoryStatus).mockResolvedValue(clean)
  await act(async () => notifyRepositoryChanged())
  expect(current.status?.entries).toHaveLength(0)
  await act(async () => window.dispatchEvent(new Event('focus')))
  expect(getRepositoryStatus).toHaveBeenCalledTimes(4)
})
it('rejects stale workspace responses and preserves dirty state when refresh fails', async () => {
  let finish!: (value: typeof clean) => void
  vi.mocked(getRepositoryStatus).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await act(async () => root.render(<Harness workspace="/a" />))
  await act(async () => root.render(<Harness workspace="/b" />))
  await act(async () => finish(clean))
  expect(current.workspace).toBe('/b')
  expect(current.status?.entries).toHaveLength(1)
  vi.mocked(getRepositoryStatus).mockRejectedValueOnce(new Error('Git unavailable'))
  await act(async () => notifyRepositoryChanged())
  expect(current.status?.entries).toHaveLength(1)
  expect(current.error).toContain('Git unavailable')
})
it('coalesces invalidations during a request and does not publish its stale result', async () => {
  let finish!: (value: typeof clean) => void
  vi.mocked(getRepositoryStatus).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await act(async () => root.render(<Harness />))
  await act(async () => { notifyRepositoryChanged(); notifyRepositoryChanged() })
  expect(getRepositoryStatus).toHaveBeenCalledOnce()
  await act(async () => finish(clean))
  expect(getRepositoryStatus).toHaveBeenCalledTimes(2)
  expect(current.status?.entries).toHaveLength(1)
})
