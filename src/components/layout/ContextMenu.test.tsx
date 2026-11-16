import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { EditorContextMenu } from '../editor/EditorContextMenu'
import { ContextMenu } from './ContextMenu'

let root: Root | null = null
let host: HTMLDivElement
beforeEach(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root?.unmount())
  root = null; host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals()
})

it('skips disabled actions, wraps arrows, and keeps one roving tab stop', async () => {
  await act(async () => root?.render(<ContextMenu x={10} y={20} label="Actions" onClose={vi.fn()}>
    <button role="menuitem" disabled>Unavailable</button>
    <button role="menuitem">First</button>
    <button role="menuitem" aria-disabled="true">Also unavailable</button>
    <button role="menuitem">Last</button>
  </ContextMenu>))
  const buttons = Array.from(host.querySelectorAll('button'))
  expect(document.activeElement).toBe(buttons[1])
  await act(async () => buttons[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true })))
  expect(document.activeElement).toBe(buttons[3])
  expect([buttons[1].tabIndex, buttons[3].tabIndex]).toEqual([-1, 0])
  await act(async () => buttons[3].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })))
  expect(document.activeElement).toBe(buttons[1])
})

it.each(['Escape', 'Tab'])('dismisses with %s and restores the previous focus', async (key) => {
  const trigger = document.body.appendChild(document.createElement('button'))
  trigger.focus()
  const close = vi.fn()
  await act(async () => root?.render(<ContextMenu x={0} y={0} label="Actions" onClose={close}>
    <button role="menuitem">First</button>
  </ContextMenu>))
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  await act(async () => document.activeElement?.dispatchEvent(event))
  expect(event.defaultPrevented).toBe(true)
  expect(close).toHaveBeenCalledExactlyOnceWith(true)
  expect(document.activeElement).toBe(trigger)
  trigger.remove()
})

it('dismisses outside pointer clicks without taking focus from the clicked control', async () => {
  const close = vi.fn()
  await act(async () => root?.render(<ContextMenu x={0} y={0} label="Actions" onClose={close}>
    <button role="menuitem">First</button>
  </ContextMenu>))
  const target = document.body.appendChild(document.createElement('button'))
  target.focus()
  await act(async () => target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })))
  expect(close).toHaveBeenCalledExactlyOnceWith(false)
  expect(document.activeElement).toBe(target)
  target.remove()
})

it('clamps the measured menu into the viewport and permits scrolling oversized content', async () => {
  vi.stubGlobal('innerWidth', 100); vi.stubGlobal('innerHeight', 100)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 200, height: 200 } as DOMRect)
  await act(async () => root?.render(<ContextMenu x={500} y={500} label="Actions" onClose={vi.fn()}>
    <button role="menuitem">First</button>
  </ContextMenu>))
  const menu = host.querySelector<HTMLElement>('[role="menu"]')!
  expect(menu.style.left).toBe('4px'); expect(menu.style.top).toBe('4px')
  expect(menu.style.maxWidth).toBe('92px'); expect(menu.style.maxHeight).toBe('92px')
  expect(menu.style.overflow).toBe('auto')
})

it('selects an editor action once and requests caret restoration', async () => {
  const run = vi.fn(); const close = vi.fn()
  await act(async () => root?.render(<EditorContextMenu x={0} y={0} onClose={close}
    items={[{ id: 'first', label: 'First', run }]} />))
  await act(async () => host.querySelector('button')!.click())
  expect(run).toHaveBeenCalledTimes(1)
  expect(close).toHaveBeenCalledExactlyOnceWith(true)
})
it('moves through editor actions with arrows, Home and End', async () => {
  await act(async () => root?.render(<EditorContextMenu x={10} y={20} onClose={vi.fn()}
    items={['First', 'Second', 'Third'].map(label => ({ id: label, label, run: vi.fn() }))} />))
  const buttons = Array.from(host.querySelectorAll('button'))
  expect(document.activeElement).toBe(buttons[0])
  await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })))
  expect(document.activeElement).toBe(buttons[1])
  await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })))
  expect(document.activeElement).toBe(buttons[2])
  await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })))
  expect(document.activeElement).toBe(buttons[0])
})

it('runs the chosen action before closing, so a close that unmounts the menu cannot cancel it', async () => {
  // In the browser React flushes the close between the capture and bubble phases of a real click,
  // unmounting the item before its handler; a script click cannot show that, so pin the order.
  const order: string[] = []
  await act(async () => root?.render(<ContextMenu x={0} y={0} label="Actions" onClose={restore => order.push(`close:${restore}`)}>
    <button role="menuitem" onClick={() => order.push('action')}>Copy file path</button>
  </ContextMenu>))
  await act(async () => host.querySelector('button')!.click())
  expect(order).toEqual(['action', 'close:true'])
})
