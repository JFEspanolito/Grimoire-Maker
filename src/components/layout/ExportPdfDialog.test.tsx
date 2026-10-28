import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { ExportPdfDialog } from './ExportPdfDialog'
import { useDocumentStore } from '../../stores/documentStore'
import { useProjectStore } from '../../stores/projectStore'
import { EMPTY_PROJECT } from '../../lib/projectSettings'
import { registerPlugin } from '../../plugins/plugin-manager'
import { mountWheelZoom } from '../../plugins/isolated/wheelZoom'

const mocks = vi.hoisted(() => ({ renderBook: vi.fn(), loadBookContents: vi.fn() }))
vi.mock('../../lib/exportPdf', () => ({ renderBook: mocks.renderBook }))
vi.mock('../../lib/bookContent', () => ({ loadBookContents: mocks.loadBookContents }))

const file = (path: string) => ({ name: path.split('/').pop()!, path, isDirectory: false })
afterEach(() => { useDocumentStore.getState().setWorkspace(null, []); useProjectStore.setState({ entries: {} }); vi.clearAllMocks() })

async function mount(onExport = vi.fn()) {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: vi.fn(function (this: HTMLDialogElement) { this.setAttribute('open', '') }) })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: vi.fn(function (this: HTMLDialogElement) { this.removeAttribute('open') }) })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(<ExportPdfDialog onClose={() => {}} onExport={onExport} />))
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  return { container, onExport, unmount: async () => { await act(async () => root.unmount()); container.remove() } }
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

const click = (element: Element | null | undefined) => act(async () => { (element as HTMLElement).click(); await new Promise((resolve) => setTimeout(resolve, 0)) })

function seed(order: string[], excluded: string[] = []) {
  useDocumentStore.getState().setWorkspace('/w', [{ name: 'Draft', path: '/w/Draft', isDirectory: true, children: [file('/w/Draft/A.md'), file('/w/Draft/B.md')] }])
  useProjectStore.setState({
    entries: { '/w': { settings: { ...EMPTY_PROJECT, documentOrder: { order, excluded } }, ready: true, busy: false, error: '' } },
    save: async (root, settings) => { useProjectStore.setState({ entries: { [root]: { settings, ready: true, busy: false, error: '' } } }); return true },
  })
  mocks.loadBookContents.mockImplementation(async (_root: string, documents: string[]) => documents.map(() => document.createElement('div')))
  mocks.renderBook.mockImplementation(async (_request, stage: HTMLElement) => { stage.innerHTML = '<div class="native-print-sheet">sheet</div>'; return 1 })
}

it('lists the documents in the preview and drops a document from the book when it is unchecked', async () => {
  seed(['Draft/A.md', 'Draft/B.md'])
  const { container, onExport, unmount } = await mount()
  expect(Array.from(container.querySelectorAll('ol[aria-label="Documents"] li span'), (node) => node.textContent)).toEqual(['A', 'B'])
  await click(container.querySelector('input[aria-label="Include A"]'))
  expect(mocks.loadBookContents).toHaveBeenLastCalledWith('/w', ['Draft/B.md'], 2)
  expect(useProjectStore.getState().entries['/w'].settings.documentOrder).toEqual({ order: ['Draft/A.md', 'Draft/B.md'], excluded: ['Draft/A.md'] })
  await click(Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Export PDF…'))
  expect(onExport.mock.calls[0][0].plan).toEqual({ root: '/w', documents: ['Draft/B.md'] })
  await unmount()
})

it('reorders the printed documents from the preview list', async () => {
  seed(['Draft/A.md', 'Draft/B.md'])
  const { container, unmount } = await mount()
  await click(container.querySelector('button[aria-label="Move A down"]'))
  expect(mocks.loadBookContents).toHaveBeenLastCalledWith('/w', ['Draft/B.md', 'Draft/A.md'], 2)
  expect(container.querySelector('button[aria-label="Move B up"]')).toHaveProperty('disabled', true)
  await unmount()
})

it('shares the saved order with other views and keeps the list when everything is unchecked', async () => {
  seed(['Draft/B.md', 'Draft/A.md'], ['Draft/A.md', 'Draft/B.md'])
  const { container, unmount } = await mount()
  expect(container.textContent).toContain('No documents are selected')
  expect(Array.from(container.querySelectorAll('ol li span'), (node) => node.textContent)).toEqual(['B', 'A'])
  await click(container.querySelector('input[aria-label="Include B"]'))
  expect(container.textContent).not.toContain('No documents are selected')
  expect(mocks.loadBookContents).toHaveBeenLastCalledWith('/w', ['Draft/B.md'], 2)
  await unmount()
})

it('has no list when the project has no Draft documents', async () => {
  useDocumentStore.getState().setWorkspace('/w', [])
  useProjectStore.setState({ entries: { '/w': { settings: EMPTY_PROJECT, ready: true, busy: false, error: '' } } })
  const { container, unmount } = await mount()
  expect(container.querySelector('ol')).toBeNull()
  await unmount()
})

it('steps the preview zoom with Ctrl+wheel inside the open Export PDF dialog', async () => {
  seed(['Draft/A.md'])
  const dispose = registerPlugin({
    id: 'test.zoom', name: 'Zoom', version: '1',
    activate: (api) => api.registerPageBehavior({
      id: 'test.zoom.wheel',
      mount: (element, surface) => mountWheelZoom(element, surface, { editor: [50, 100], preview: [40, 50, 60, 75, 100] }),
    }),
  })
  const { container, unmount } = await mount()
  try {
    const preview = container.querySelector('[data-theme]')!
    const select = container.querySelector<HTMLSelectElement>('select[aria-label="Preview zoom"]')!
    expect(select.value).toBe('0.35')
    await act(async () => {
      preview.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -10, bubbles: true, cancelable: true }))
    })
    expect(select.value).toBe('0.4')
  } finally {
    await unmount()
    dispose()
  }
})
