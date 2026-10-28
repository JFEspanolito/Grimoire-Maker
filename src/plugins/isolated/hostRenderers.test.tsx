import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExternalPluginEntry } from '../../lib/externalPlugins'
import { useRulerStore } from '../../stores/rulerStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTabStore } from '../../stores/tabStore'
import { registerPlugin, usePluginRegistry } from '../plugin-manager'
import { registerHostContributions } from './hostContributions'

const reportError = vi.hoisted(() => vi.fn())
vi.mock('../../lib/errorLogging', () => ({ reportError }))

const ZOOM = ['editor:zoom:read', 'editor:zoom:write']
const RULER = ['editor:geometry:read', 'editor:guides:read', 'editor:guides:write']
const EDITOR_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3].map((v) => ({ value: String(v), label: `${v * 100}%` }))
const PREVIEW_OPTIONS = [0.4, 0.5, 0.6, 0.75, 1].map((v) => ({ value: String(v), label: `${v * 100}%` }))

const entry = (permissions: string[], extra: Partial<ExternalPluginEntry> = {}): ExternalPluginEntry => ({
  id: 'builtin.test', version: '1.0.0', fingerprint: 'f', sdkVersion: 2, permissions, toolbar: [], behaviors: [], overlays: [], tools: [],
  origin: 'local', source: '', ...extra,
})
const zoomParts = {
  toolbar: [
    { id: 'zoom-editor', type: 'select' as const, label: 'Zoom', bind: 'zoom' as const, when: 'markdown' as const, options: EDITOR_OPTIONS },
    { id: 'zoom-preview', type: 'select' as const, label: 'Zoom', bind: 'surfaceZoom' as const, slot: 'preview' as const, options: PREVIEW_OPTIONS },
  ],
  behaviors: [{
    id: 'zoom-wheel', type: 'wheelZoom' as const,
    editorSteps: [25, 50, 75, 100, 125, 150, 175, 200, 250, 300], previewSteps: [40, 50, 60, 75, 100],
  }],
}
const rulerParts = {
  toolbar: [{ id: 'ruler-toggle', type: 'toggle' as const, label: 'Ruler', bind: 'rulerVisible' as const, when: 'markdown' as const, options: [] }],
  overlays: [{ id: 'ruler-overlay', type: 'ruler' as const }],
  tools: [{ id: 'guides', type: 'guidesMenu' as const, label: 'Guides' }],
}

let root: Root | undefined
let host: HTMLDivElement
const disposers: Array<() => void> = []

/** Registers through the real manager so ids, duplicates and disposal behave like production. */
function begin(plugin: ExternalPluginEntry, send = vi.fn()) {
  const dispose = registerPlugin({
    id: `external.${plugin.id}`, name: plugin.id, version: '1',
    activate: (api) => registerHostContributions(api, plugin, send),
  })
  disposers.push(dispose)
  return { dispose, send, registry: usePluginRegistry.getState() }
}
const find = <T extends { id: string }>(list: T[], suffix: string) => list.find((item) => item.id.endsWith(suffix))!

beforeEach(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  useSettingsStore.setState({ zoom: 1, pageSize: 'a4', marginMm: 15, bleedMm: 3, rulerGuides: [], viewMode: 'edit' })
  useTabStore.getState().reset('/book/page.md')
  useRulerStore.getState().reset()
  host = document.createElement('div')
  document.body.append(host)
  reportError.mockClear()
})
afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = undefined
  host.remove()
  for (const dispose of disposers.splice(0)) dispose()
  useTabStore.getState().reset(null)
  vi.restoreAllMocks()
})

const render = async (node: React.ReactNode) => { root = createRoot(host); await act(async () => root?.render(node)) }
const change = (select: HTMLSelectElement, value: string) =>
  act(async () => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })) })
const values = (select: HTMLSelectElement) => [...select.options].map((option) => option.value)

describe('bound zoom controls', () => {
  it('shows the manifest options plus the current value, sorted, and writes the setting', async () => {
    const { registry } = begin(entry(ZOOM, zoomParts))
    const Toolbar = find(registry.toolbar, '.toolbar').component
    await render(<Toolbar />)
    const select = host.querySelector<HTMLSelectElement>('[aria-label="Editor zoom"]')!
    expect(values(select)).toEqual(EDITOR_OPTIONS.map((option) => option.value))
    await change(select, '1.5')
    expect(useSettingsStore.getState().zoom).toBe(1.5)
    await act(async () => useSettingsStore.getState().setZoom(1.33))
    expect(select.value).toBe('1.33')
    expect([...select.options].map((option) => option.textContent)).toContain('133%')
    const numeric = values(select).map(Number)
    expect(numeric).toEqual([...numeric].sort((a, b) => a - b))
  })

  it('is disabled for a non-Markdown active file and enabled again for Markdown', async () => {
    const { registry } = begin(entry(ZOOM, zoomParts))
    const Toolbar = find(registry.toolbar, '.toolbar').component
    await render(<Toolbar />)
    const select = host.querySelector<HTMLSelectElement>('[aria-label="Editor zoom"]')!
    expect(select.disabled).toBe(false)
    await act(async () => useTabStore.getState().open('/book/image.png'))
    expect(select.disabled).toBe(true)
    await act(async () => useTabStore.getState().open('/book/other.MD'))
    expect(select.disabled).toBe(false)
  })

  it('renders the preview select bound to the surface zoom', async () => {
    const { registry } = begin(entry(ZOOM, zoomParts))
    const Preview = find(registry.previewToolbar, 'zoom-preview').component
    const setZoom = vi.fn()
    await render(<Preview surface={{ kind: 'preview', zoom: 0.9, setZoom }} />)
    const select = host.querySelector<HTMLSelectElement>('[aria-label="Preview zoom"]')!
    expect(values(select)).toEqual(['0.4', '0.5', '0.6', '0.75', '0.9', '1'])
    expect(select.value).toBe('0.9')
    await change(select, '0.5')
    expect(setZoom).toHaveBeenCalledWith(0.5)
    expect(useSettingsStore.getState().zoom).toBe(1)
  })
})

describe('wheel zoom behavior', () => {
  const mount = (kind: 'editor' | 'preview', zoom: number) => {
    const { registry } = begin(entry(ZOOM, zoomParts))
    const setZoom = vi.fn()
    const stop = find(registry.pageBehaviors, 'zoom-wheel').mount(host, { kind, zoom, setZoom })
    return { setZoom, stop }
  }
  const wheel = (deltaY = -10, ctrlKey = true) => {
    const event = new WheelEvent('wheel', { ctrlKey, deltaY, cancelable: true })
    host.dispatchEvent(event)
    return event
  }

  it('steps to the next and previous editor stop with Ctrl only', () => {
    const { setZoom } = mount('editor', 1)
    expect(wheel(-10, false).defaultPrevented).toBe(false)
    expect(setZoom).not.toHaveBeenCalled()
    expect(wheel(-10).defaultPrevented).toBe(true)
    expect(setZoom).toHaveBeenLastCalledWith(1.25)
    wheel(10)
    expect(setZoom).toHaveBeenLastCalledWith(0.75)
  })

  it('uses the preview steps on the preview surface and stops at the ends', () => {
    const { setZoom, stop } = mount('preview', 0.75)
    wheel(-10)
    expect(setZoom).toHaveBeenLastCalledWith(1)
    stop()
    disposers.pop()?.()
    const upper = mount('preview', 1)
    wheel(-10)
    expect(upper.setZoom).not.toHaveBeenCalled()
  })

  it('ignores a prevented wheel, a zero delta and an open dialog, and removes its listener', () => {
    const { setZoom, stop } = mount('editor', 1)
    host.addEventListener('wheel', (event) => event.preventDefault(), { capture: true, once: true })
    wheel(-10)
    expect(setZoom).not.toHaveBeenCalled()
    wheel(0)
    expect(setZoom).not.toHaveBeenCalled()
    const dialog = document.createElement('dialog')
    dialog.setAttribute('open', '')
    document.body.append(dialog)
    expect(wheel(-10).defaultPrevented).toBe(false)
    dialog.setAttribute('data-find-panel', '')
    expect(wheel(-10).defaultPrevented).toBe(true)
    expect(setZoom).toHaveBeenLastCalledWith(1.25)
    dialog.remove()
    stop()
    expect(wheel(-10).defaultPrevented).toBe(false)
    expect(setZoom).toHaveBeenCalledTimes(1)
  })

  it('listens on the surrounding editor pane so wheel events in the gutter also step zoom', () => {
    const pane = document.createElement('section')
    pane.setAttribute('data-active-editor', 'true')
    const sheet = document.createElement('div')
    pane.append(sheet)
    host.append(pane)
    const { registry } = begin(entry(ZOOM, zoomParts))
    const setZoom = vi.fn()
    const stop = find(registry.pageBehaviors, 'zoom-wheel').mount(sheet, { kind: 'editor', zoom: 1, setZoom })
    const event = new WheelEvent('wheel', { ctrlKey: true, deltaY: 10, bubbles: true, cancelable: true })
    pane.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(setZoom).toHaveBeenCalledWith(0.75)
    stop()
  })
})

describe('command controls', () => {
  it('keeps sending commands for unbound buttons and selects', async () => {
    const { registry, send } = begin(entry([], {
      toolbar: [
        { id: 'go', type: 'button', label: 'Go', command: 'go', options: [] },
        { id: 'pick', type: 'select', label: 'Pick', command: 'pick', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] },
        { id: 'inert', type: 'button', label: 'Inert', options: [] },
      ],
    }))
    const Toolbar = find(registry.toolbar, '.toolbar').component
    await render(<Toolbar />)
    await act(async () => host.querySelector<HTMLButtonElement>('button')!.click())
    expect(send).toHaveBeenCalledWith('go', null)
    await change(host.querySelector<HTMLSelectElement>('select')!, 'b')
    expect(send).toHaveBeenCalledWith('pick', 'b')
    expect(host.textContent).not.toContain('Inert')
  })
})

describe('ruler', () => {
  const setup = async () => {
    const { registry } = begin(entry(RULER, rulerParts))
    const Toolbar = find(registry.toolbar, '.toolbar').component
    const Overlay = find(registry.overlays, 'ruler-overlay').component
    const Guides = find(registry.editorTools, 'guides').component
    await render(<><Toolbar /><Guides /><Overlay /></>)
  }
  const button = (label: string) => host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!
  const dragPointer = (handle: HTMLElement, pointerId: number) => {
    Object.assign(handle, { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn(), hasPointerCapture: () => true })
    return (type: string, position: { clientX?: number; clientY?: number }) => act(async () => {
      const event = new MouseEvent(type, { bubbles: true, button: 0, ...position })
      Object.defineProperty(event, 'pointerId', { value: pointerId })
      handle.dispatchEvent(event)
    })
  }
  const guides = () => useSettingsStore.getState().rulerGuides

  it('toggles measurements, off by default, disabled for non-Markdown files', async () => {
    await setup()
    const toggle = button('Ruler')
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    expect(host.querySelector('[data-ruler-overlay]')).toBeNull()
    await act(async () => toggle.click())
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(host.textContent).toContain('margin 15')
    expect(host.textContent).toContain('bleed 3')
    await act(async () => useTabStore.getState().open('/book/image.png'))
    expect(toggle.disabled).toBe(true)
  })

  it('keeps guides visible while measurements are off, without label or boxes', async () => {
    await setup()
    await act(async () => useSettingsStore.getState().setRulerGuides([{ id: 'g', axis: 'row', positionMm: 50 }]))
    expect(host.querySelector('[data-guide-axis="row"]')).not.toBeNull()
    expect(host.textContent).not.toContain('margin')
    expect(useSettingsStore.getState().viewMode).toBe('edit')
  })

  it('moves guides with 1 mm and Shift 10 mm keys, removes with Delete and cancels with Escape', async () => {
    await setup()
    await act(async () => useSettingsStore.getState().setRulerGuides([{ id: 'g', axis: 'row', positionMm: 50 }]))
    const key = (init: KeyboardEventInit) =>
      act(async () => button('Move row guide').dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init })))
    await key({ key: 'ArrowDown' })
    expect(guides()[0].positionMm).toBe(51)
    await key({ key: 'ArrowUp', shiftKey: true })
    expect(guides()[0].positionMm).toBe(41)
    await key({ key: 'Escape' })
    expect(guides()[0].positionMm).toBe(41)
    await key({ key: 'Delete' })
    expect(guides()).toEqual([])
  })

  it('drags at page scale, commits only on release and discards a cancelled draft', async () => {
    await setup()
    host.className = 'grimoire-page'
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 420, height: 594 } as DOMRect)
    await act(async () => useSettingsStore.getState().setRulerGuides([{ id: 'g', axis: 'row', positionMm: 40 }]))
    const pointer = dragPointer(button('Move row guide'), 1)
    await pointer('pointerdown', { clientY: 80 })
    await pointer('pointermove', { clientY: 120 })
    expect(host.querySelector<HTMLElement>('[data-guide-axis]')!.style.top).toBe('60mm')
    expect(guides()[0].positionMm).toBe(40)
    await pointer('pointerup', { clientY: 120 })
    expect(guides()[0].positionMm).toBe(60)
    await pointer('pointerdown', { clientY: 120 })
    await pointer('pointermove', { clientY: 180 })
    await pointer('pointercancel', { clientY: 180 })
    expect(host.querySelector<HTMLElement>('[data-guide-axis]')!.style.top).toBe('60mm')
    expect(guides()[0].positionMm).toBe(60)
  })

  it('keeps fractional column positions after a drag', async () => {
    await setup()
    host.className = 'grimoire-page'
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 420, height: 594 } as DOMRect)
    await act(async () => useSettingsStore.getState().setRulerGuides([{ id: 'c', axis: 'column', positionMm: 40 }]))
    const pointer = dragPointer(button('Move column guide'), 9)
    await pointer('pointerdown', { clientX: 80 })
    await pointer('pointermove', { clientX: 113 })
    await pointer('pointerup', { clientX: 113 })
    expect(guides()[0].positionMm).toBe(56.5)
  })

  it('retains off-page guides when the paper shrinks and flags them in the menu', async () => {
    await setup()
    await act(async () => useSettingsStore.getState().setRulerGuides([{ id: 'g', axis: 'row', positionMm: 271 }]))
    await act(async () => useSettingsStore.getState().setPageSize('b5'))
    expect(host.querySelector('[data-guide-axis]')).toBeNull()
    expect(host.textContent).toContain('Outside page')
    expect(guides()[0].positionMm).toBe(271)
    await act(async () => button('Remove Row 1').click())
    expect(guides()).toEqual([])
  })

  it('adds rows and columns, edits positions numerically and clears', async () => {
    await setup()
    await act(async () => button('Add row guide').click())
    await act(async () => button('Add row guide').click())
    await act(async () => button('Add column guide').click())
    expect(guides().map((guide) => [guide.axis, guide.positionMm])).toEqual([['row', 25], ['row', 35], ['column', 25]])
    const input = host.querySelector<HTMLInputElement>('[aria-label="Row 1 position (mm)"]')!
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => { setValue.call(input, '99.94'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    expect(guides()[0].positionMm).toBe(99.9)
    await act(async () => Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Clear')!.click())
    expect(guides()).toEqual([])
  })

  it('closes the guides menu on outside pointerdown and Escape', async () => {
    await setup()
    const menu = host.querySelector<HTMLDetailsElement>('details')!
    await act(async () => { menu.open = true })
    await act(async () => { document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })) })
    expect(menu.open).toBe(false)
    await act(async () => { menu.open = true })
    await act(async () => { menu.querySelector('summary')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(menu.open).toBe(false)
  })
})

describe('registration rules', () => {
  it('skips contributions whose permissions are not granted and keeps the rest', () => {
    const { registry } = begin(entry(['editor:guides:read', 'editor:guides:write'], {
      toolbar: [...zoomParts.toolbar, ...rulerParts.toolbar], behaviors: zoomParts.behaviors, overlays: rulerParts.overlays, tools: rulerParts.tools,
    }))
    expect(registry.previewToolbar).toHaveLength(0)
    expect(registry.pageBehaviors).toHaveLength(0)
    expect(registry.overlays).toHaveLength(0)
    expect(registry.editorTools.map((tool) => tool.id)).toEqual(['external.builtin.test.guides'])
    expect(registry.toolbar).toHaveLength(1)
    expect(reportError).toHaveBeenCalled()
  })

  it('removes every contribution and resets the ruler when the plugin stops', () => {
    const { dispose, registry } = begin(entry([...ZOOM, ...RULER], {
      toolbar: [...zoomParts.toolbar, ...rulerParts.toolbar], behaviors: zoomParts.behaviors, overlays: rulerParts.overlays, tools: rulerParts.tools,
    }))
    expect(registry.toolbar).toHaveLength(1)
    expect(registry.previewToolbar).toHaveLength(1)
    expect(registry.pageBehaviors).toHaveLength(1)
    expect(registry.overlays).toHaveLength(1)
    expect(registry.editorTools).toHaveLength(1)
    useRulerStore.getState().toggle()
    dispose()
    const after = usePluginRegistry.getState()
    for (const key of ['toolbar', 'previewToolbar', 'pageBehaviors', 'overlays', 'editorTools'] as const) expect(after[key]).toHaveLength(0)
    expect(useRulerStore.getState().visible).toBe(false)
  })
})

describe('readable toolbar styling', () => {
  const css = readFileSync('src/plugins/isolated/ExternalToolbar.module.css', 'utf8')

  it('gives host-rendered selects, toggles and plugin buttons their styled class names', async () => {
    const parts = {
      toolbar: [
        ...zoomParts.toolbar.slice(0, 1), ...rulerParts.toolbar,
        { id: 'pick', type: 'select' as const, label: 'Pick', command: 'pick', options: [{ value: 'a', label: 'A' }] },
        { id: 'go', type: 'button' as const, label: 'Go', command: 'go', options: [] },
      ],
    }
    const { registry } = begin(entry([...ZOOM, ...RULER], parts))
    const Toolbar = find(registry.toolbar, '.toolbar').component
    await render(<Toolbar />)
    const labels = [...host.querySelectorAll('label')]
    expect(labels).toHaveLength(2)
    for (const label of labels) expect(label.className).toMatch(/control/)
    expect(host.querySelector('[aria-label="Ruler"]')!.className).toMatch(/toggle/)
    expect([...host.querySelectorAll('button')].find((b) => b.textContent === 'Go')!.className).toMatch(/button/)
  })

  it('declares the dark select look: light text on a dark background, readable options and a visible focus ring', () => {
    expect(css).toMatch(/\.control select \{[^}]*background: #302f2c[^}]*color: #f0eee9[^}]*color-scheme: dark/)
    expect(css).toMatch(/\.control select option \{[^}]*background: #302f2c[^}]*color: #f0eee9/)
    expect(css).toMatch(/\.control select \{[^}]*border: 1px solid #ffffff20/)
    expect(css).toMatch(/\.control \{[^}]*color: #d1c5ad/)
    expect(css).toContain('.control select:disabled { opacity: .4')
    expect(css).toContain('outline: 2px solid #cfb37c')
    expect(css).toMatch(/\.toggle, \.button \{[^}]*color: #d1c5ad/)
  })
})
