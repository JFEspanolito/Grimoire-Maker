import { beforeEach, expect, it, vi } from 'vitest'
import { exists, readTextFile } from '@tauri-apps/plugin-fs'
import { restoreGitDocuments } from './gitDocumentRestore'
import { runFileAction } from '../hooks/useFileSystem'
import { useDocumentStore } from '../stores/documentStore'
import { useTabStore } from '../stores/tabStore'

vi.mock('@tauri-apps/plugin-fs', async (importOriginal) => ({
  ...await importOriginal<typeof import('@tauri-apps/plugin-fs')>(), exists: vi.fn(), readTextFile: vi.fn(),
}))
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}
beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true })
  useDocumentStore.getState().resetDocuments()
  useDocumentStore.getState().loadFromRaw('/book/a.md', 'old A')
  useDocumentStore.getState().loadFromRaw('/book/b.md', 'old B')
  useTabStore.getState().reset('/book/a.md')
  useTabStore.getState().open('/book/b.md', true)
  vi.mocked(exists).mockResolvedValue(true)
  vi.mocked(readTextFile).mockImplementation(async (path) => `restored ${String(path)}`)
})

it('reloads every restored buffer and keeps the active pane, then permits fresh edits', async () => {
  const active = useTabStore.getState()
  await restoreGitDocuments('/book', undefined, async () => {})
  const state = useDocumentStore.getState()
  expect(state.buffers['/book/a.md']).toMatchObject({ body: 'restored /book/a.md', dirty: false })
  expect(state.document).toMatchObject({ path: '/book/b.md', body: 'restored /book/b.md', dirty: false })
  expect(useTabStore.getState().panes).toEqual(active.panes)
  expect(state.restoringPaths).toEqual([])
  state.setBody('fresh edit')
  expect(useDocumentStore.getState().document.dirty).toBe(true)
})

it('blocks dirty affected backgrounds without touching disk, but preserves unrelated dirty buffers', async () => {
  const store = useDocumentStore.getState()
  store.setBodyForPath('/book/a.md', 'unsaved A')
  const operation = vi.fn()
  await expect(restoreGitDocuments('/book', ['a.md'], operation)).rejects.toThrow('unsaved changes')
  expect(operation).not.toHaveBeenCalled()
  expect(readTextFile).not.toHaveBeenCalled()
  await restoreGitDocuments('/book', ['b.md'], async () => {})
  expect(useDocumentStore.getState().buffers['/book/a.md']).toMatchObject({ body: 'unsaved A', dirty: true })
})

it('drains the same save queue and freezes edits until reconciliation completes', async () => {
  const saving = deferred(); const savingStarted = deferred(); const restoring = deferred(); const restoringStarted = deferred()
  let saved = false
  const save = runFileAction(async () => { savingStarted.resolve(); await saving.promise; saved = true })
  await savingStarted.promise
  const restore = restoreGitDocuments('/book', undefined, async () => {
    expect(saved).toBe(true)
    restoringStarted.resolve()
    await restoring.promise
  })
  expect(useDocumentStore.getState().restoringPaths).toEqual([])
  saving.resolve(); await save; await restoringStarted.promise
  const state = useDocumentStore.getState()
  state.setBody('typing during IPC')
  state.setBodyForPath('/book/a.md', 'background edit')
  state.setRawForPath('/book/a.md', 'raw edit')
  state.setFrontmatter({ title: 'changed during IPC' })
  expect(useDocumentStore.getState().document.body).toBe('old B')
  expect(useDocumentStore.getState().buffers['/book/a.md'].body).toBe('old A')
  let autosaveBody: string | undefined
  const queuedSave = runFileAction(async () => { autosaveBody = useDocumentStore.getState().buffers['/book/a.md'].body })
  restoring.resolve(); await restore; await queuedSave
  expect(autosaveBody).toBe('restored /book/a.md')
})

it('drops deleted and unreadable buffers/tabs and reports reload errors', async () => {
  vi.mocked(exists).mockImplementation(async (path) => String(path) !== '/book/a.md')
  vi.mocked(readTextFile).mockRejectedValueOnce(new Error('Permission denied'))
  await expect(restoreGitDocuments('/book', undefined, async () => {})).rejects.toThrow('Permission denied')
  expect(useDocumentStore.getState().buffers['/book/a.md']).toBeUndefined()
  expect(useDocumentStore.getState().buffers['/book/b.md']).toBeUndefined()
  expect(useTabStore.getState().paths).toEqual([])
  expect(useDocumentStore.getState().restoringPaths).toEqual([])
})

it('reconciles completed mutations even when a later Git operation rejects', async () => {
  await expect(restoreGitDocuments('/book', undefined, async () => { throw new Error('second file failed') })).rejects.toThrow('second file failed')
  expect(useDocumentStore.getState().buffers['/book/a.md'].body).toBe('restored /book/a.md')
  expect(useDocumentStore.getState().document.body).toBe('restored /book/b.md')
  expect(useDocumentStore.getState().restoringPaths).toEqual([])
})

it.each([true, false])('preserves unrelated dirty untitled work after a restore (scoped=%s)', async (scoped) => {
  useDocumentStore.getState().loadFromRaw(null, '# Untitled draft')
  useDocumentStore.getState().setBody('# Unsaved untitled draft')
  useTabStore.getState().reset(null)
  const untitled = useDocumentStore.getState().document
  const tabs = useTabStore.getState()

  await restoreGitDocuments('/book', scoped ? ['a.md'] : undefined, async () => {})

  expect(useDocumentStore.getState().document).toBe(untitled)
  expect(useDocumentStore.getState().document).toMatchObject({ path: null, body: '# Unsaved untitled draft', dirty: true })
  expect(useDocumentStore.getState().buffers.__untitled__).toBe(untitled)
  expect(useTabStore.getState().active).toBe(tabs.active)
  expect(useTabStore.getState().panes).toEqual(tabs.panes)
  expect(useDocumentStore.getState().buffers['/book/a.md'].body).toBe('restored /book/a.md')
})
