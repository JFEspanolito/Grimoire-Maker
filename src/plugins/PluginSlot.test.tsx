import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { PluginBoundary } from './PluginSlot'
import { reportError } from '../lib/errorLogging'

vi.mock('../lib/errorLogging', () => ({ reportError: vi.fn() }))
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)

it('keeps a failed plugin isolated and retries only when its implementation changes', async () => {
  const host = document.createElement('div')
  const root = createRoot(host)
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  function Broken(): never { throw new Error('Plugin failed') }
  function Repaired() { return <span>Recovered widget</span> }
  try {
    await act(async () => root.render(<PluginBoundary identity={Broken} title="Notes"><Broken /></PluginBoundary>))
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Notes: plugin failed')
    expect(reportError).toHaveBeenCalledWith('plugin.render', expect.any(Error))
    await act(async () => root.render(<PluginBoundary identity={Broken} title="Notes"><Repaired /></PluginBoundary>))
    expect(host.textContent).not.toContain('Recovered widget')
    await act(async () => root.render(<PluginBoundary identity={Repaired} title="Notes"><Repaired /></PluginBoundary>))
    expect(host.textContent).toBe('Recovered widget')
    expect(host.querySelector('[role="alert"]')).toBeNull()
  } finally { await act(async () => root.unmount()); consoleError.mockRestore() }
})
