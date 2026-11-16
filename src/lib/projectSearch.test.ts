import { beforeEach, expect, it, vi } from 'vitest'
import { applyProjectReplace, ProjectChangedError, undoProjectReplace, type ProjectSearch, type AppliedChange } from './projectSearch'
import { commitProjectReplace, snapshotProjectTexts } from './projectReplace'
import { useDocumentStore } from '../stores/documentStore'
vi.mock('./projectReplace', () => ({ commitProjectReplace: vi.fn(), snapshotProjectTexts: vi.fn() }))
const query = { term: 'old', caseSensitive: true }
const change: AppliedChange = { path: '/book/a.md', snapshotPath: '/book/a.md', kind: 'file', before: 'old', after: 'new' }
const search: ProjectSearch = {
  docs: [{ path: change.path, snapshotPath: change.path, body: 'old', raw: 'old', open: false }],
  files: [{ path: change.path, open: false, matches: [{ id: 'a', path: change.path, index: 0, start: 0, end: 3, line: 1, context: 'old', contextStart: 0, contextEnd: 3 }] }],
  knownPaths: [change.path], total: 1, truncated: false,
}
beforeEach(() => {
  vi.resetAllMocks(); useDocumentStore.getState().resetDocuments()
  vi.mocked(snapshotProjectTexts).mockResolvedValue([{ path: change.path, before: 'new' }])
  vi.mocked(commitProjectReplace).mockResolvedValue([change.path])
})
it.each(['Permission denied', 'Disk full', 'IPC disconnected'])('preserves %s as the cause of replace and undo failures', async (message) => {
  const failure = new Error(message, { cause: 'native failure' })
  vi.mocked(commitProjectReplace).mockRejectedValue(failure)
  await expect(applyProjectReplace('/book', search, query, 'new', new Set(['a']))).rejects.toBe(failure)
  await expect(undoProjectReplace('/book', [change])).rejects.toBe(failure)
})
it.each([
  'The project documents changed since the search (a file was added or removed). Search again.',
  'A document changed since the search: /book/a.md. Search again.',
])('translates only the native conflict %s', async (message) => {
  vi.mocked(commitProjectReplace).mockRejectedValue(new Error(message))
  await expect(applyProjectReplace('/book', search, query, 'new', new Set(['a']))).rejects.toBeInstanceOf(ProjectChangedError)
  await expect(undoProjectReplace('/book', [change])).resolves.toEqual({ restored: 0, skipped: [change.path] })
})
it('still commits disk replacements and restores them on successful undo', async () => {
  const applied = await applyProjectReplace('/book', search, query, 'new', new Set(['a']))
  expect(applied).toEqual({ changes: [change], matches: 1 })
  expect(commitProjectReplace).toHaveBeenCalledWith('/book', [{ path: change.path, before: 'old', after: 'new' }], [change.path])
  await expect(undoProjectReplace('/book', applied.changes)).resolves.toEqual({ restored: 1, skipped: [] })
})
it('does not partly undo buffers when a disk operation fails', async () => {
  useDocumentStore.getState().loadFromRaw('/book/open.md', 'new')
  const failure = new Error('Disk full')
  vi.mocked(commitProjectReplace).mockRejectedValue(failure)
  await expect(undoProjectReplace('/book', [
    { path: '/book/open.md', kind: 'buffer', before: 'old', after: 'new' }, change,
  ])).rejects.toBe(failure)
  expect(useDocumentStore.getState().document.body).toBe('new')
})
it('preserves typing that occurs while disk undo is pending', async () => {
  useDocumentStore.getState().loadFromRaw('/book/open.md', 'new')
  let finish!: (paths: string[]) => void
  vi.mocked(commitProjectReplace).mockReturnValue(new Promise<string[]>((resolve) => { finish = resolve }))
  const undo = undoProjectReplace('/book', [{ path: '/book/open.md', kind: 'buffer', before: 'old', after: 'new' }, change])
  await vi.waitFor(() => expect(commitProjectReplace).toHaveBeenCalledTimes(1))
  useDocumentStore.getState().setBody('new typing during disk write')
  finish([change.path])
  await expect(undo).resolves.toEqual({ restored: 1, skipped: ['/book/open.md'] })
  expect(useDocumentStore.getState().document.body).toBe('new typing during disk write')
})
