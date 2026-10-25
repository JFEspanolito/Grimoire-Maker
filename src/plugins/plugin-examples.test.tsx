import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import zoom from '../assets/mods/Plugins/zoom/zoom'
import ruler from '../assets/mods/Plugins/pixel-ruler/pixel-ruler'
import type { PluginApi, PluginPageBehavior, PluginPanel, PluginSurfaceWidget } from '../types/plugin'
import { useSettingsStore } from '../stores/settingsStore'
import { useTabStore } from '../stores/tabStore'

function capture() {
  const toolbar: PluginPanel[] = []
  const editorTools: PluginPanel[] = []
  const overlays: PluginPanel[] = []
  const previews: PluginSurfaceWidget[] = []
  const behaviors: PluginPageBehavior[] = []
  const cleanup: (() => void)[] = []
  const api: PluginApi = {
    registerToolbar: value => { toolbar.push(value) },
    registerEditorTool: value => { editorTools.push(value) },
    registerOverlay: value => { overlays.push(value) },
    registerPreviewToolbar: value => { previews.push(value) },
    registerPageBehavior: value => { behaviors.push(value) },
    registerCommand: vi.fn(), registerPanel: vi.fn(), addStyle: vi.fn(),
    onCleanup: value => { cleanup.push(value) },
    getActiveBody: () => '', insertContent: vi.fn(), on: () => () => {},
  }
  return { api, toolbar, editorTools, overlays, previews, behaviors, cleanup }
}

let root: Root | undefined
let host: HTMLDivElement
beforeEach(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  useSettingsStore.setState({ zoom: 1, pageSize: 'a4', marginMm: 15, bleedMm: 3, rulerGuides: [] })
  useTabStore.getState().reset('/book/page.md')
  host = document.createElement('div')
  document.body.append(host)
})
afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = undefined
  host.remove()
  useTabStore.getState().reset(null)
  vi.restoreAllMocks()
})

it('registers the complete Zoom toolbar and preview controls with shared settings', async () => {
  const registered = capture()
  zoom.activate(registered.api)
  const Control = registered.toolbar[0].component
  const Preview = registered.previews[0].component
  const setZoom = vi.fn()
  root = createRoot(host)
  await act(async () => root?.render(<><Control /><Preview surface={{ kind: 'preview', zoom: .75, setZoom }} /></>))
  const control = host.querySelector<HTMLSelectElement>('[aria-label="Editor zoom"]')!
  expect([...control.options].map(option => option.value)).toEqual(['0.25', '0.5', '0.75', '1', '1.25', '1.5', '1.75', '2', '2.5', '3'])
  await act(async () => { control.value = '1.5'; control.dispatchEvent(new Event('change', { bubbles: true })) })
  expect(useSettingsStore.getState().zoom).toBe(1.5)
  await act(async () => useSettingsStore.getState().setZoom(1.33))
  expect(control.value).toBe('1.33')
  const preview = host.querySelector<HTMLSelectElement>('[aria-label="Preview zoom"]')!
  await act(async () => { preview.value = '0.5'; preview.dispatchEvent(new Event('change', { bubbles: true })) })
  expect(setZoom).toHaveBeenCalledWith(.5)
  await act(async () => useTabStore.getState().open('/book/image.png'))
  expect(control.disabled).toBe(true)
})

it('owns Ctrl-wheel zoom and removes its native listener when unmounted', () => {
  const registered = capture()
  zoom.activate(registered.api)
  const setZoom = vi.fn()
  const stop = registered.behaviors[0].mount(host, { kind: 'editor', zoom: 1, setZoom })
  const wheel = (ctrlKey = true) => {
    const event = new WheelEvent('wheel', { ctrlKey, deltaY: -10, cancelable: true })
    host.dispatchEvent(event)
    return event
  }
  expect(wheel(false).defaultPrevented).toBe(false)
  expect(setZoom).not.toHaveBeenCalled()
  expect(wheel().defaultPrevented).toBe(true)
  expect(setZoom).toHaveBeenCalledWith(1.25)
  const dialog = document.createElement('dialog')
  dialog.setAttribute('open', '')
  document.body.append(dialog)
  expect(wheel().defaultPrevented).toBe(false)
  dialog.remove()
  stop()
  setZoom.mockClear()
  expect(wheel().defaultPrevented).toBe(false)
  expect(setZoom).not.toHaveBeenCalled()
})

it('provides Ruler toggle, guide editing and overlay without owning document contents', async () => {
  const registered = capture()
  ruler.activate(registered.api)
  const Toggle = registered.toolbar[0].component
  const Guides = registered.editorTools[0].component
  const Overlay = registered.overlays[0].component
  root = createRoot(host)
  await act(async () => root?.render(<><Toggle /><Guides /><Overlay /></>))
  const toggle = host.querySelector<HTMLButtonElement>('[aria-label="Ruler"]')!
  expect(toggle.getAttribute('aria-pressed')).toBe('false')
  await act(async () => toggle.click())
  expect(host.textContent).toContain('margin 15')
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Add row guide"]')!.click())
  expect(useSettingsStore.getState().rulerGuides).toHaveLength(1)
  const handle = host.querySelector<HTMLButtonElement>('[aria-label="Move row guide"]')!
  const previous = useSettingsStore.getState().rulerGuides[0].positionMm
  await act(async () => handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true })))
  expect(useSettingsStore.getState().rulerGuides[0].positionMm).toBe(previous + 10)
  await act(async () => toggle.click())
  expect(host.querySelector('[data-guide-axis="row"]')).not.toBeNull()
  await act(async () => root?.unmount())
  root = undefined
  for (const dispose of registered.cleanup) dispose()
  ruler.deactivate?.()
  expect(useSettingsStore.getState().rulerGuides).toHaveLength(1)
})

it('drags Ruler guides at page scale, commits on release and cancels without overwriting saved guides', async () => {
  const registered = capture()
  ruler.activate(registered.api)
  const Overlay = registered.overlays[0].component
  host.className = 'grimoire-page'
  vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 420, height: 594 } as DOMRect)
  useSettingsStore.getState().setRulerGuides([{ id: 'dragged', axis: 'row', positionMm: 40 }])
  root = createRoot(host)
  await act(async () => root?.render(<Overlay />))
  const handle = host.querySelector<HTMLButtonElement>('[aria-label="Move row guide"]')!
  handle.setPointerCapture = vi.fn()
  handle.hasPointerCapture = () => true
  handle.releasePointerCapture = vi.fn()
  const pointer = async (type: string, clientY: number) => act(async () => {
    const event = new MouseEvent(type, { bubbles: true, button: 0, clientY })
    Object.defineProperty(event, 'pointerId', { value: 1 })
    handle.dispatchEvent(event)
  })
  await pointer('pointerdown', 80)
  await pointer('pointermove', 120)
  expect(host.querySelector<HTMLElement>('[data-guide-axis]')!.style.top).toBe('60mm')
  expect(useSettingsStore.getState().rulerGuides[0].positionMm).toBe(40)
  await pointer('pointerup', 120)
  expect(useSettingsStore.getState().rulerGuides[0].positionMm).toBe(60)
  await pointer('pointerdown', 120)
  await pointer('pointermove', 180)
  await pointer('pointercancel', 180)
  expect(host.querySelector<HTMLElement>('[data-guide-axis]')!.style.top).toBe('60mm')
  expect(useSettingsStore.getState().rulerGuides[0].positionMm).toBe(60)
})
