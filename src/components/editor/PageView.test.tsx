import { DocumentPathContext } from './DocumentPathContext'
import { useDocumentStore } from '../../stores/documentStore'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PageView } from './PageView'
import { useSettingsStore } from '../../stores/settingsStore'
import zoomPlugin from '../../assets/mods/Plugins/zoom/zoom'
import { registerPlugin, unregisterPlugin } from '../../plugins/plugin-manager'

beforeEach(() => { vi.stubGlobal('CSS', { supports: () => true }); registerPlugin(zoomPlugin) })
afterEach(() => { vi.unstubAllGlobals(); unregisterPlugin(zoomPlugin.id) })

it('zooms only the editor wrapper while preserving physical page dimensions and content', async () => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  const host = document.createElement('div')
  const root = createRoot(host)
  try {
    useSettingsStore.setState({ zoom: 2, pageSize: 'a4' })
    await act(async () => root.render(<PageView><p>Unchanged text</p></PageView>))
    expect(host.querySelector<HTMLElement>('[data-editor-zoom]')?.style.zoom).toBe('2')
    expect(host.querySelector<HTMLElement>('.grimoire-page')?.style.width).toBe('210mm')
    expect(host.textContent).toBe('Unchanged text')
  } finally {
    await act(async () => root.unmount())
    useSettingsStore.setState({ zoom: 1 })
  }
})

it('uses Ctrl+wheel to step editor zoom without changing page size or normal scrolling', async () => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  const host = document.createElement('div')
  const root = createRoot(host)
  const wheel = async (deltaY: number, ctrlKey = true) => {
    const event = new WheelEvent('wheel', { deltaY, ctrlKey, bubbles: true, cancelable: true })
    await act(async () => host.querySelector('p')!.dispatchEvent(event))
    return event
  }
  try {
    useSettingsStore.setState({ zoom: 1, pageSize: 'a4' })
    await act(async () => root.render(<PageView><p>Unchanged text</p></PageView>))
    expect((await wheel(-100)).defaultPrevented).toBe(true)
    expect(useSettingsStore.getState().zoom).toBe(1.25)
    await wheel(100)
    expect(useSettingsStore.getState().zoom).toBe(1)
    const dialog = document.createElement('dialog')
    dialog.open = true
    document.body.append(dialog)
    try {
      expect((await wheel(-100)).defaultPrevented).toBe(false)
      expect(useSettingsStore.getState().zoom).toBe(1)
    } finally { dialog.remove() }
    expect((await wheel(-100, false)).defaultPrevented).toBe(false)
    expect((await wheel(0)).defaultPrevented).toBe(false)
    expect(useSettingsStore.getState().zoom).toBe(1)
    await act(async () => useSettingsStore.getState().setZoom(3))
    expect((await wheel(-100)).defaultPrevented).toBe(true)
    expect(useSettingsStore.getState().zoom).toBe(3)
    await act(async () => useSettingsStore.getState().setZoom(.25))
    await wheel(100)
    expect(useSettingsStore.getState().zoom).toBe(.25)
    await act(async () => useSettingsStore.getState().setZoom(1.1))
    await wheel(-100)
    expect(useSettingsStore.getState().zoom).toBe(1.25)
    expect(host.querySelector<HTMLElement>('.grimoire-page')?.style.width).toBe('210mm')
    expect(host.textContent).toBe('Unchanged text')
    const detached = host.querySelector('p')!
    await act(async () => root.unmount())
    detached.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, bubbles: true }))
    expect(useSettingsStore.getState().zoom).toBe(1.25)
  } finally {
    await act(async () => root.unmount())
    useSettingsStore.setState({ zoom: 1 })
  }
})

it('lays out sequential physical sheets without changing the document or global columns', async () => {
  let resized!: ResizeObserverCallback
  const disconnect = vi.fn()
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { resized = callback }
    observe() {}
    disconnect = disconnect
  })
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  const host = document.createElement('div')
  const root = createRoot(host)
  const original = useSettingsStore.getState()
  try {
    useSettingsStore.setState({ columns: 2, pageSize: 'a4', marginMm: 15 })
    await act(async () => root.render(<PageView><p>Original paragraph</p></PageView>))
    const flow = host.querySelector<HTMLElement>('[data-page-flow]')!
    expect(flow).not.toBeNull()
    expect(flow.dataset.paginated).toBe('true')
    expect(flow.style.getPropertyValue('--page-columns')).toBe('2')
    expect(flow.style.getPropertyValue('--content-height')).toBe('267mm')
    expect(flow.style.getPropertyValue('--row-gap')).toBe('38mm')
    // Two content rows, separated by the bottom/top margins and an 8 mm gap.
    await act(async () => resized([{ contentRect: { height: (267 * 2 + 38) * 96 / 25.4 } }] as ResizeObserverEntry[], {} as ResizeObserver))
    const sheets = host.querySelectorAll<HTMLElement>('[data-editor-sheet]')
    expect(sheets).toHaveLength(2)
    expect(sheets[1].style.top).toBe('305mm')
    expect(sheets[1].style.height).toBe('297mm')
    expect(host.querySelectorAll('p')).toHaveLength(1)
    expect(flow.textContent).toBe('Original paragraph')
    expect(useSettingsStore.getState().columns).toBe(2)
    await act(async () => resized([{ contentRect: { height: 267 * 96 / 25.4 } }] as ResizeObserverEntry[], {} as ResizeObserver))
    expect(host.querySelectorAll('[data-editor-sheet]')).toHaveLength(1)
    await act(async () => root.unmount())
    expect(disconnect).toHaveBeenCalledOnce()
  } finally {
    await act(async () => root.unmount())
    useSettingsStore.setState(original)
  }
})

it('keeps unsupported WebViews readable without changing the selected print columns', async () => {
  vi.stubGlobal('CSS', { supports: () => false })
  const host = document.createElement('div')
  const root = createRoot(host)
  try {
    useSettingsStore.setState({ columns: 2 })
    await act(async () => root.render(<PageView><p>Original paragraph</p></PageView>))
    expect(host.querySelector('[data-page-flow]')?.getAttribute('data-paginated')).toBe('false')
    expect(host.querySelector('[role="status"]')?.textContent).toContain('newer WebView')
    expect(useSettingsStore.getState().columns).toBe(2)
  } finally { await act(async () => root.unmount()) }
})

it('uses each split document column override without changing the default', async () => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  useSettingsStore.setState({ columns: 2 })
  useDocumentStore.getState().loadFromRaw('/a.md', '---\ncolumns: 1\n---\nA')
  useDocumentStore.getState().loadFromRaw('/b.md', 'B')
  const host = document.createElement('div')
  const root = createRoot(host)
  try {
    await act(async () => root.render(<><DocumentPathContext value="/a.md"><PageView>A</PageView></DocumentPathContext><DocumentPathContext value="/b.md"><PageView>B</PageView></DocumentPathContext></>))
    const flows = host.querySelectorAll<HTMLElement>('[data-page-flow]')
    expect(flows[0].style.getPropertyValue('--page-columns')).toBe('1')
    expect(flows[1].style.getPropertyValue('--page-columns')).toBe('2')
    expect(useSettingsStore.getState().columns).toBe(2)
  } finally { await act(async () => root.unmount()); useDocumentStore.getState().resetDocuments() }
})

it('switches page presentation without replacing editable content or zoom', async () => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  const host = document.createElement('div')
  const root = createRoot(host)
  try {
    useSettingsStore.setState({ viewMode: 'edit', zoom: 1.25, pageSize: 'b5' })
    await act(async () => root.render(<PageView><div contentEditable suppressContentEditableWarning>Keep editing</div></PageView>))
    const editor = host.querySelector('[contenteditable]')
    await act(async () => useSettingsStore.getState().setViewMode('spreads'))
    expect(host.querySelector('[contenteditable]')).toBe(editor)
    expect(host.querySelector('[data-page-layout]')?.getAttribute('data-page-layout')).toBe('spreads')
    expect(host.querySelectorAll('[data-editor-sheet]')).toHaveLength(2)
    expect(host.querySelector<HTMLElement>('[data-editor-zoom]')?.style.zoom).toBe('1.25')
    await act(async () => useSettingsStore.getState().setViewMode('edit'))
    expect(host.querySelector('[contenteditable]')).toBe(editor)
    expect(host.querySelectorAll('[data-editor-sheet]')).toHaveLength(1)
  } finally { await act(async () => root.unmount()); useSettingsStore.setState({ viewMode: 'edit', zoom: 1 }) }
})
