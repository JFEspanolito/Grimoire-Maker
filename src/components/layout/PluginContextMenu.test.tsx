import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { PluginContextAction } from '../../types/plugin'
import { PluginContextMenu } from './PluginContextMenu'
const h = vi.hoisted(() => ({ actions: [] as PluginContextAction[], report: vi.fn() }))
vi.mock('../../plugins/plugin-manager', () => ({ usePluginRegistry: (select: (state: { contextActions: PluginContextAction[] }) => unknown) => select({ contextActions: h.actions }) }))
vi.mock('../../lib/errorLogging', () => ({ reportError: h.report }))
let root: Root
let container: HTMLDivElement
beforeEach(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  h.actions = []; h.report.mockClear()
  container = document.body.appendChild(document.createElement('div'))
  root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove() })
async function open() {
  await act(async () => root.render(<PluginContextMenu />))
  await act(async () => container.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))
}
it('requires predicates to return true and reports thrown predicate errors', async () => {
  h.actions = [
    { id: 'truthy', label: 'Truthy', when: (() => 'yes') as unknown as () => boolean, run() {} },
    { id: 'throws', label: 'Throws', when() { throw new Error('broken predicate') }, run() {} },
  ]
  await open()
  expect(document.querySelector('[role="menu"]')).toBeNull()
  expect(h.report).toHaveBeenCalledWith('plugin.contextAction.when', expect.any(Error))
})
it('renders the supplied icon for any plugin id and reports action failures', async () => {
  h.actions = [{ id: 'custom.action', label: 'Custom', icon: '★', run() { throw new Error('broken action') } }]
  await open()
  const item = document.querySelector<HTMLButtonElement>('[role="menuitem"]')!
  expect(item.textContent).toContain('★')
  await act(async () => item.click())
  expect(h.report).toHaveBeenCalledWith('plugin.contextAction.run', expect.any(Error))
})
