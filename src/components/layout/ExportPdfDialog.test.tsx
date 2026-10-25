import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { ExportPdfDialog } from './ExportPdfDialog'
import { useDocumentStore } from '../../stores/documentStore'
import { useProjectStore } from '../../stores/projectStore'
import { EMPTY_PROJECT } from '../../lib/projectSettings'

const mocks = vi.hoisted(() => ({ renderBook: vi.fn(), loadBookContents: vi.fn() }))
vi.mock('../../lib/exportPdf', () => ({ renderBook: mocks.renderBook }))
vi.mock('../../lib/bookContent', () => ({ loadBookContents: mocks.loadBookContents }))

const file = (path: string) => ({ name: path.split('/').pop()!, path, isDirectory: false })
afterEach(() => { useDocumentStore.getState().setWorkspace(null, []); useProjectStore.setState({ entries: {} }); vi.clearAllMocks() })

async function mount(onExport = vi.fn()) {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: vi.fn() })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: vi.fn() })
  const container = document.createElement('div')
  const root = createRoot(container)
  await act(async () => root.render(<ExportPdfDialog onClose={() => {}} onExport={onExport} />))
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  return { container, onExport, unmount: () => act(async () => root.unmount()) }
}

it('previews the ordered book from the project and hands it to the export', async () => {
  useDocumentStore.getState().setWorkspace('/w', [{ name: 'Draft', path: '/w/Draft', isDirectory: true, children: [file('/w/Draft/A.md'), file('/w/Draft/B.md')] }])
  useProjectStore.setState({ entries: { '/w': { settings: { ...EMPTY_PROJECT, documentOrder: { order: ['Draft/B.md', 'Draft/A.md'], excluded: [] } }, ready: true, busy: false, error: '' } } })
  const contents = [document.createElement('div'), document.createElement('div')]
  mocks.loadBookContents.mockResolvedValue(contents)
  mocks.renderBook.mockImplementation(async (_request, stage: HTMLElement) => { stage.innerHTML = '<div class="native-print-sheet">sheet</div>'; return 4 })
  const { container, onExport, unmount } = await mount()
  expect(mocks.loadBookContents).toHaveBeenCalledWith('/w', ['Draft/B.md', 'Draft/A.md'], 2)
  expect(container.querySelector('.native-print-sheet')?.textContent).toBe('sheet')
  expect(container.textContent).toContain('4 pages')
  await act(async () => Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Export PDF…')!.click())
  expect(onExport).toHaveBeenCalledWith({ plan: { root: '/w', documents: ['Draft/B.md', 'Draft/A.md'] }, contents })
  await unmount()
})

it('explains that nothing is selected instead of exporting an empty book', async () => {
  useDocumentStore.getState().setWorkspace('/w', [{ name: 'Draft', path: '/w/Draft', isDirectory: true, children: [file('/w/Draft/A.md')] }])
  useProjectStore.setState({ entries: { '/w': { settings: { ...EMPTY_PROJECT, documentOrder: { order: ['Draft/A.md'], excluded: ['Draft/A.md'] } }, ready: true, busy: false, error: '' } } })
  const { container, unmount } = await mount()
  expect(container.textContent).toContain('No documents are selected')
  expect(Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Export PDF…')!.disabled).toBe(true)
  expect(mocks.renderBook).not.toHaveBeenCalled()
  await unmount()
})
