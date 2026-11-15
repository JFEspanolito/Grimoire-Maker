import { beforeEach, expect, it, vi } from 'vitest'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { renderDocumentHtml } from '../components/editor/renderDocumentContent'
import { useDocumentStore } from '../stores/documentStore'
import { loadBookContents } from './bookContent'

vi.mock('@tauri-apps/plugin-fs', () => ({ readTextFile: vi.fn() }))
vi.mock('../components/editor/renderDocumentContent', () => ({ renderDocumentHtml: vi.fn(async (body: string) => {
  const element = document.createElement('div'); element.textContent = body; return element
}) }))
vi.mock('./exportPdf', () => ({ printableContent: (element: HTMLElement, columns: number) => {
  element.dataset.columns = String(columns); return element
} }))
beforeEach(() => { vi.clearAllMocks(); useDocumentStore.getState().resetDocuments() })

it('exports active edits, inactive buffers and disk-only chapters in the requested book order', async () => {
  useDocumentStore.getState().loadFromRaw('C:/book/Draft/a.md', '# Saved A')
  useDocumentStore.getState().setBody('# Unsaved A')
  useDocumentStore.getState().loadFromRaw('C:/book/Draft/b.md', '# Saved B')
  useDocumentStore.getState().setBody('# Unsaved B')
  vi.mocked(readTextFile).mockResolvedValue('---\ntitle: Metadata\n---\n# Disk C')
  const contents = await loadBookContents('C:\\book\\', ['Draft/b.md', 'Draft/c.md', 'Draft/a.md'], 2)
  expect(contents.map(element => element.textContent)).toEqual(['# Unsaved B', '# Disk C', '# Unsaved A'])
  expect(contents.every(element => element.dataset.columns === '2')).toBe(true)
  expect(readTextFile).toHaveBeenCalledExactlyOnceWith('C:/book/Draft/c.md')
  expect(vi.mocked(renderDocumentHtml).mock.calls.map(call => call[1])).toEqual(['C:/book/Draft/b.md', 'C:/book/Draft/c.md', 'C:/book/Draft/a.md'])
})

it('propagates unreadable chapters instead of returning a partial book', async () => {
  const failure = new Error('Permission denied')
  vi.mocked(readTextFile).mockRejectedValue(failure)
  await expect(loadBookContents('/book', ['missing.md'], 1)).rejects.toBe(failure)
})
