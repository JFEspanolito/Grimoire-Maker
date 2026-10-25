import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAutoCommit } from './useAutoCommit'
import { useSettingsStore } from '../stores/settingsStore'
import { useDocumentStore } from '../stores/documentStore'

const mocks = vi.hoisted(() => ({ commit: vi.fn(), native: vi.fn(), notify: vi.fn(), report: vi.fn() }))
vi.mock('./useFileSystem', () => ({ isTauri: mocks.native }))
vi.mock('../lib/versionControl', () => ({ autoCommitChanges: mocks.commit }))
vi.mock('../lib/repositoryEvents', () => ({ notifyRepositoryChanged: mocks.notify }))
vi.mock('../lib/errorLogging', () => ({ reportError: mocks.report }))
let root: ReturnType<typeof createRoot>
function Harness({ ready = true }) { useAutoCommit(ready); return null }
beforeEach(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  vi.useFakeTimers(); vi.clearAllMocks()
  mocks.native.mockReturnValue(true); mocks.commit.mockResolvedValue('committed')
  useSettingsStore.setState({ autoCommitEnabled: true, autoCommitMinutes: 20, autoCommitMessage: 'update content automatically' })
  useDocumentStore.setState({ workspaceRoot: '/book' })
  root = createRoot(document.createElement('div'))
})
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers() })
it('waits twenty minutes, uses configurable message and restarts on interval or workspace changes', async () => {
  await act(async () => root.render(<Harness />))
  await act(async () => vi.advanceTimersByTimeAsync(1199999))
  expect(mocks.commit).not.toHaveBeenCalled()
  await act(async () => vi.advanceTimersByTimeAsync(1))
  expect(mocks.commit).toHaveBeenCalledExactlyOnceWith('/book', 'update content automatically')
  expect(mocks.notify).toHaveBeenCalledOnce()
  await act(async () => useSettingsStore.setState({ autoCommitMinutes: 1, autoCommitMessage: 'Custom update' }))
  await act(async () => vi.advanceTimersByTimeAsync(30000))
  await act(async () => useDocumentStore.setState({ workspaceRoot: '/other' }))
  await act(async () => vi.advanceTimersByTimeAsync(30000))
  expect(mocks.commit).toHaveBeenCalledOnce()
  await act(async () => vi.advanceTimersByTimeAsync(30000))
  expect(mocks.commit).toHaveBeenLastCalledWith('/other', 'Custom update')
})
it.each(['disabled', 'not-ready', 'browser', 'no-project'])('does nothing when %s', async reason => {
  if (reason === 'disabled') useSettingsStore.setState({ autoCommitEnabled: false })
  if (reason === 'browser') mocks.native.mockReturnValue(false)
  if (reason === 'no-project') useDocumentStore.setState({ workspaceRoot: null })
  await act(async () => root.render(<Harness ready={reason !== 'not-ready'} />))
  await act(async () => vi.advanceTimersByTimeAsync(2400000))
  expect(mocks.commit).not.toHaveBeenCalled()
})
it('never overlaps pending operations and cancels future ticks when disabled', async () => {
  let finish!: (result: string) => void
  mocks.commit.mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve }))
  await act(async () => root.render(<Harness />))
  await act(async () => vi.advanceTimersByTimeAsync(1200000))
  await act(async () => useSettingsStore.setState({ autoCommitMinutes: 1 }))
  await act(async () => vi.advanceTimersByTimeAsync(180000))
  expect(mocks.commit).toHaveBeenCalledOnce()
  await act(async () => useSettingsStore.setState({ autoCommitEnabled: false }))
  await act(async () => finish('committed'))
  await act(async () => vi.advanceTimersByTimeAsync(2400000))
  expect(mocks.commit).toHaveBeenCalledOnce()
})
it.each(['gitUnavailable', 'noRepository', 'unchanged'])('silently skips %s', async result => {
  mocks.commit.mockResolvedValue(result)
  await act(async () => root.render(<Harness />))
  await act(async () => vi.advanceTimersByTimeAsync(1200000))
  expect(mocks.report).not.toHaveBeenCalled()
  expect(mocks.notify).not.toHaveBeenCalled()
})
it('refreshes staged changes when staging cancels an edit without creating a commit', async () => {
  mocks.commit.mockResolvedValue('indexUpdated')
  await act(async () => root.render(<Harness />))
  await act(async () => vi.advanceTimersByTimeAsync(1200000))
  expect(mocks.notify).toHaveBeenCalledOnce()
  expect(mocks.report).not.toHaveBeenCalled()
})
it('reports failures and refreshes possible partial staging without unhandled rejections', async () => {
  mocks.commit.mockRejectedValueOnce(new Error('Commit failed'))
  await act(async () => root.render(<Harness />))
  await act(async () => vi.advanceTimersByTimeAsync(1200000))
  expect(mocks.report).toHaveBeenCalledWith('git.autoCommit', expect.any(Error))
  expect(mocks.notify).toHaveBeenCalledOnce()
  await act(async () => vi.advanceTimersByTimeAsync(1200000))
  expect(mocks.commit).toHaveBeenCalledTimes(2)
})
