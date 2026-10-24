import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { pixelRuler } from './index'
import { registerPlugin, usePluginRegistry } from '../../plugin-manager'
import { useSettingsStore } from '../../../stores/settingsStore'
import { useDocumentStore } from '../../../stores/documentStore'

let root: Root
let host: HTMLDivElement
registerPlugin(pixelRuler)
const Overlay = usePluginRegistry.getState().overlays.find((entry) => entry.id === 'pixel-ruler.overlay')!.component
const toggle = () => usePluginRegistry.getState().commands.find((entry) => entry.id === 'pixel-ruler.toggle')!.run()
const button = (label: string) => host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!

beforeEach(async () => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  useSettingsStore.setState({ pageSize: 'a4', rulerGuides: [] })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(<Overlay />))
  if (!host.firstChild) await act(async () => toggle())
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  useSettingsStore.setState({ pageSize: 'a4', rulerGuides: [] })
})

it('moves guides with the keyboard, removes them, and retains off-page guides when changing paper size', async () => {
  await act(async () => useSettingsStore.getState().setRulerGuides([{ id: 'one', axis: 'row', positionMm: 270 }]))
  const handle = button('Move row guide')
  await act(async () => handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
  expect(useSettingsStore.getState().rulerGuides[0]?.positionMm).toBe(271)
  await act(async () => useSettingsStore.getState().setPageSize('b5'))
  expect(host.querySelector('[data-guide-axis]')).toBeNull()
  expect(host.textContent).toContain('Outside page')
  expect(useSettingsStore.getState().rulerGuides[0]?.positionMm).toBe(271)
  await act(async () => button('Remove Row 1').click())
  expect(useSettingsStore.getState().rulerGuides).toEqual([])
})

it('drags at the rendered page scale and only commits on release; cancellation discards the draft', async () => {
  host.className = 'grimoire-page'
  vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 420, height: 594 } as DOMRect)
  await act(async () => useSettingsStore.getState().setRulerGuides([{ id: 'one', axis: 'row', positionMm: 40 }]))
  const handle = button('Move row guide')
  handle.setPointerCapture = vi.fn()
  handle.releasePointerCapture = vi.fn()
  handle.hasPointerCapture = () => true
  const pointer = async (type: string, y: number) => act(async () => {
    const event = new MouseEvent(type, { bubbles: true, button: 0, clientY: y })
    Object.defineProperty(event, 'pointerId', { value: 1 })
    handle.dispatchEvent(event)
  })
  await pointer('pointerdown', 80)
  await pointer('pointermove', 120)
  expect(host.querySelector<HTMLElement>('[data-guide-axis]')?.style.top).toBe('60mm')
  expect(useSettingsStore.getState().rulerGuides[0]?.positionMm).toBe(40)
  await pointer('pointerup', 120)
  expect(useSettingsStore.getState().rulerGuides[0]?.positionMm).toBe(60)
  await pointer('pointerdown', 120)
  await pointer('pointermove', 180)
  await pointer('pointercancel', 180)
  expect(host.querySelector<HTMLElement>('[data-guide-axis]')?.style.top).toBe('60mm')
  expect(useSettingsStore.getState().rulerGuides[0]?.positionMm).toBe(60)
})

it('adds many visual row and column guides without changing document content', async () => {
  const before = useDocumentStore.getState().document
  expect(button('Add row guide')).not.toBeNull()
  for (let n = 0; n < 30; n++) await act(async () => button('Add row guide').click())
  await act(async () => button('Add column guide').click())
  expect(host.querySelectorAll('[data-guide-axis="row"]')).toHaveLength(30)
  expect(host.querySelectorAll('[data-guide-axis="column"]')).toHaveLength(1)
  expect(useDocumentStore.getState().document).toBe(before)
  const saved = useSettingsStore.getState()
  await act(async () => toggle())
  expect(host.firstChild).toBeNull()
  await act(async () => toggle())
  expect(host.querySelectorAll('[data-guide-axis]')).toHaveLength(31)
  expect(useSettingsStore.getState()).toBe(saved)
})

it('column dragging keeps fractional positions without snapping and Delete/Clear leave document unchanged', async () => {
  host.className = 'grimoire-page'
  vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 420, height: 594 } as DOMRect)
  const before = useDocumentStore.getState().document
  await act(async () => useSettingsStore.getState().setRulerGuides([{ id: 'column-one', axis: 'column', positionMm: 40 }, { id: 'row-one', axis: 'row', positionMm: 45 }]))
  const handle = button('Move column guide')
  handle.setPointerCapture = vi.fn()
  handle.releasePointerCapture = vi.fn()
  handle.hasPointerCapture = () => true
  const pointer = async (type: string, x: number) => act(async () => {
    const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x })
    Object.defineProperty(event, 'pointerId', { value: 9 })
    handle.dispatchEvent(event)
  })
  await pointer('pointerdown', 80)
  await pointer('pointermove', 113)
  await pointer('pointerup', 113)
  expect(useSettingsStore.getState().rulerGuides[0]?.positionMm).toBe(56.5)
  await act(async () => handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true })))
  expect(useSettingsStore.getState().rulerGuides.map(g => g.id)).toEqual(['row-one'])
  await act(async () => Array.from(host.querySelectorAll('button')).find(b => b.textContent === 'Clear')!.click())
  expect(useSettingsStore.getState().rulerGuides).toEqual([])
  expect(useDocumentStore.getState().document).toBe(before)
})
