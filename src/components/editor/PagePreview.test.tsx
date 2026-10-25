import { useDocumentStore } from '../../stores/documentStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { StrictMode, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Previewer } from 'pagedjs'
import { paginate } from '../../lib/exportPdf'
import { PagePreview } from './PagePreview'

vi.mock('../../lib/exportPdf', () => ({ paginate: vi.fn() }))

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  vi.useFakeTimers()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.useRealTimers()
  vi.clearAllMocks()
})

// Use the installed Paged.js Polisher, including its unsafe pre-setup destroy().
function initialize(previewer: Previewer, target: HTMLElement) {
  const polisher = previewer.polisher as Previewer['polisher'] & { setup(): void }
  polisher.setup()
  target.innerHTML = '<div class="pagedjs_page">First page</div><div class="pagedjs_page">Second page</div>'
  return vi.spyOn(polisher, 'destroy')
}

it('survives StrictMode cleanup before the debounce and renders pages', async () => {
  let destroy: ReturnType<typeof vi.spyOn> | undefined
  vi.mocked(paginate).mockImplementation(async (previewer, _request, target) => { destroy = initialize(previewer, target) })
  await act(async () => root.render(<StrictMode><PagePreview mode="pages" /></StrictMode>))
  expect(paginate).not.toHaveBeenCalled()
  await act(async () => vi.advanceTimersByTimeAsync(400))
  expect(paginate).toHaveBeenCalledOnce()
  expect(container.querySelector('[role="status"]')?.textContent).toBe('2 pages')
  await act(async () => root.render(null))
  expect(destroy).toHaveBeenCalledOnce()
})

it('can leave the preview before pagination starts', async () => {
  await act(async () => root.render(<PagePreview mode="pages" />))
  await act(async () => root.render(null))
  await act(async () => vi.advanceTimersByTimeAsync(400))
  expect(paginate).not.toHaveBeenCalled()
})

it.each(['pages', 'spreads'] as const)('paginates outside display zoom and keeps two static pages in %s mode', async (mode) => {
  let targetStage!: HTMLElement
  let removePages!: ReturnType<typeof vi.spyOn>
  vi.mocked(paginate).mockImplementation(async (previewer, _request, target) => {
    targetStage = target
    expect(target.isConnected).toBe(true)
    expect(target.closest('.page-preview')).toBeNull()
    initialize(previewer, target)
    removePages = vi.spyOn(previewer.chunker, 'removePages').mockImplementation(() => target.replaceChildren())
  })
  await act(async () => root.render(<PagePreview mode={mode} />))
  await act(async () => vi.advanceTimersByTimeAsync(400))
  expect(container.querySelector('[role="status"]')?.textContent).toBe('2 pages')
  expect(removePages).toHaveBeenCalledOnce()
  expect(targetStage.isConnected).toBe(false)
  expect(container.querySelectorAll('.pagedjs_page')).toHaveLength(2)
  const zoom = container.querySelector('select')!
  await act(async () => {
    zoom.value = '0.4'
    zoom.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await act(async () => root.render(<PagePreview mode={mode === 'pages' ? 'spreads' : 'pages'} />))
  await act(async () => vi.advanceTimersByTimeAsync(1000))
  expect(paginate).toHaveBeenCalledOnce()
  expect(container.querySelectorAll('.pagedjs_page')).toHaveLength(2)
  expect(container.textContent).toContain('First pageSecond page')
})

it('disconnects page listeners before removing completed preview styles', async () => {
  const pageDestroy = vi.fn()
  let destroy: ReturnType<typeof vi.spyOn> | undefined
  vi.mocked(paginate).mockImplementation(async (previewer, _request, target) => {
    destroy = initialize(previewer, target)
    const chunker = previewer.chunker as Previewer['chunker'] & { pages: { destroy(): void }[] }
    chunker.pages.push({ destroy: pageDestroy })
  })
  await act(async () => root.render(<PagePreview mode="pages" />))
  await act(async () => vi.advanceTimersByTimeAsync(400))
  await act(async () => root.render(null))
  expect(pageDestroy).toHaveBeenCalledOnce()
  expect(pageDestroy.mock.invocationCallOrder[0]).toBeLessThan(destroy!.mock.invocationCallOrder[0]!)
})

it('keeps a pagination error visible and safely unmounts before Polisher setup', async () => {
  vi.mocked(paginate).mockRejectedValue(new Error('Editor content not found'))
  await act(async () => root.render(<PagePreview mode="pages" />))
  await act(async () => vi.advanceTimersByTimeAsync(400))
  expect(container.querySelector('[role="status"]')?.textContent).toBe('Preview failed: Editor content not found')
  await act(async () => root.render(null))
})

it.each(['resolve', 'reject'] as const)('releases styles after an in-flight preview settles with %s, not while it is running', async (outcome) => {
  let finish!: () => void
  let destroy: ReturnType<typeof vi.spyOn> | undefined
  vi.mocked(paginate).mockImplementation((previewer, _request, target) => {
    destroy = initialize(previewer, target)
    return new Promise<void>((resolve, reject) => { finish = () => outcome === 'resolve' ? resolve() : reject(new Error('Cancelled preview failed')) })
  })
  await act(async () => root.render(<PagePreview mode="spreads" />))
  await act(async () => vi.advanceTimersByTimeAsync(400))
  await act(async () => root.render(null))
  expect(container.querySelector('.pagedjs_page')).toBeNull()
  expect(destroy).not.toHaveBeenCalled()
  await act(async () => finish())
  expect(destroy).toHaveBeenCalledOnce()
})

it('zooms the preview with Ctrl+wheel without repaginating or capturing plain scrolling', async () => {
  vi.mocked(paginate).mockImplementation(async (previewer, _request, target) => { initialize(previewer, target) })
  await act(async () => root.render(<PagePreview mode="pages" />))
  await act(async () => vi.advanceTimersByTimeAsync(400))
  const preview = container.querySelector<HTMLElement>('.page-preview')!
  const wheel = async (deltaY: number, ctrlKey = true) => {
    const event = new WheelEvent('wheel', { deltaY, ctrlKey, bubbles: true, cancelable: true })
    await act(async () => preview.dispatchEvent(event))
    return event
  }
  expect((await wheel(-100)).defaultPrevented).toBe(true)
  expect(preview.style.zoom).toBe('1')
  await wheel(100)
  expect(preview.style.zoom).toBe('0.75')
  expect((await wheel(100, false)).defaultPrevented).toBe(false)
  expect(preview.style.zoom).toBe('0.75')
  await act(async () => vi.advanceTimersByTimeAsync(400))
  expect(paginate).toHaveBeenCalledOnce()
})

it('paginates the selected file with its column override', async () => {
  vi.mocked(paginate).mockImplementation(async (previewer, _request, target) => { initialize(previewer, target) })
  useSettingsStore.setState({ columns: 2 })
  useDocumentStore.getState().loadFromRaw('/book/a.md', '---\ncolumns: 1\n---\nA')
  await act(async () => root.render(<PagePreview mode="pages" />))
  await act(async () => vi.advanceTimersByTimeAsync(400))
  expect(vi.mocked(paginate).mock.calls.at(-1)![1].columns).toBe(1)
  await act(async () => useDocumentStore.getState().loadFromRaw('/book/b.md', 'B'))
  await act(async () => vi.advanceTimersByTimeAsync(400))
  expect(vi.mocked(paginate).mock.calls.at(-1)![1].columns).toBe(2)
  await act(async () => useDocumentStore.getState().resetDocuments())
})
