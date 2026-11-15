import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TerminalPanel } from './TerminalPanel'

interface FakeTerminal {
  write: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
  data?: (value: string) => void
  resize?: (value: { rows: number; cols: number }) => void
}
interface Payload { sessionId: string; data?: string }
const h = vi.hoisted(() => ({
  terms: [] as FakeTerminal[],
  listeners: new Map<string, (event: { payload: Payload }) => void>(),
  unlisten: [] as Array<ReturnType<typeof vi.fn>>,
  invoke: vi.fn(), listen: vi.fn(), fit: vi.fn(),
  observers: [] as Array<{ callback: () => void; observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }>,
}))
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: h.invoke }))
vi.mock('@tauri-apps/api/event', () => ({ listen: h.listen }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit = h.fit } }))
vi.mock('@xterm/xterm', () => ({ Terminal: class {
  rows = 24; cols = 80
  write = vi.fn(); writeln = vi.fn(); dispose = vi.fn(); clear = vi.fn()
  loadAddon() {} open() {}
  constructor() { h.terms.push(this) }
  onData(callback: (value: string) => void) { Object.assign(this, { data: callback }); return { dispose: vi.fn() } }
  onResize(callback: (value: { rows: number; cols: number }) => void) { Object.assign(this, { resize: callback }); return { dispose: vi.fn() } }
} }))
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
let root: Root | null
beforeEach(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  h.terms.length = 0; h.listeners.clear(); h.unlisten.length = 0
  h.invoke.mockReset().mockResolvedValue('session-1'); h.listen.mockReset(); h.fit.mockReset()
  h.observers.length = 0
  vi.stubGlobal('ResizeObserver', class {
    observe = vi.fn(); disconnect = vi.fn()
    callback: () => void
    constructor(callback: () => void) { this.callback = callback; h.observers.push(this) }
  })
  h.listen.mockImplementation(async (name: string, callback: (event: { payload: Payload }) => void) => {
    h.listeners.set(name, callback)
    const off = vi.fn(); h.unlisten.push(off); return off
  })
  root = createRoot(document.createElement('div'))
})
afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = null
  vi.unstubAllGlobals()
})
it.each([0, 1])('disposes a listener that resolves after unmount (registration %s)', async (index) => {
  const pending = deferred<() => void>(); const off = vi.fn()
  if (index === 0) h.listen.mockImplementationOnce(() => pending.promise)
  else h.listen.mockImplementationOnce(async () => vi.fn()).mockImplementationOnce(() => pending.promise)
  await act(async () => root?.render(<TerminalPanel workspace="/book" />))
  await act(async () => root?.unmount()); root = null
  await act(async () => pending.resolve(off))
  expect(off).toHaveBeenCalledTimes(1)
  expect(h.invoke).not.toHaveBeenCalledWith('spawn_terminal', expect.anything())
})
it('closes a pending spawn before starting the next workspace and ignores foreign events', async () => {
  const pending = deferred<string>()
  h.invoke.mockImplementation((name: string) => name === 'spawn_terminal' ? pending.promise : Promise.resolve())
  await act(async () => root?.render(<TerminalPanel workspace="/first" />))
  const firstOutput = h.listeners.get('terminal-output')!
  await act(async () => root?.render(<TerminalPanel workspace="/second" />))
  h.invoke.mockImplementation((name: string) => Promise.resolve(name === 'spawn_terminal' ? 'session-2' : undefined))
  await act(async () => pending.resolve('session-1'))
  const calls = h.invoke.mock.calls.map(([name]) => name)
  expect(calls).toEqual(['spawn_terminal', 'close_terminal', 'spawn_terminal'])
  expect(h.invoke).toHaveBeenCalledWith('close_terminal', { sessionId: 'session-1' })
  firstOutput({ payload: { sessionId: 'session-1', data: 'obsolete' } })
  h.listeners.get('terminal-output')!({ payload: { sessionId: 'session-1', data: 'foreign' } })
  h.listeners.get('terminal-exit')!({ payload: { sessionId: 'session-1' } })
  expect(h.terms[1].write).not.toHaveBeenCalled()
  h.listeners.get('terminal-output')!({ payload: { sessionId: 'session-2', data: 'current' } })
  expect(h.terms[1].write).toHaveBeenCalledWith('current')
  h.terms[1].data?.('help\r'); h.terms[1].resize?.({ rows: 30, cols: 90 })
  expect(h.invoke).toHaveBeenCalledWith('write_terminal', { sessionId: 'session-2', data: 'help\r' })
  expect(h.invoke).toHaveBeenCalledWith('resize_terminal', { sessionId: 'session-2', rows: 30, cols: 90 })
})
it('keeps early output and does not spawn a discarded StrictMode effect', async () => {
  h.invoke.mockImplementation(async (name: string) => {
    if (name === 'spawn_terminal') {
      h.listeners.get('terminal-output')!({ payload: { sessionId: 'session-1', data: 'prompt' } })
      return 'session-1'
    }
  })
  await act(async () => root?.render(<StrictMode><TerminalPanel workspace="/book" /></StrictMode>))
  expect(h.invoke.mock.calls.filter(([name]) => name === 'spawn_terminal')).toHaveLength(1)
  expect(h.terms.at(-1)!.write).toHaveBeenCalledWith('prompt')
})

it('fits the observed container, forwards its size and disconnects on unmount', async () => {
  h.fit.mockImplementation(() => h.terms.at(-1)?.resize?.({ rows: 35, cols: 100 }))
  await act(async () => root?.render(<TerminalPanel workspace="/book" />))
  expect(h.observers).toHaveLength(1)
  expect(h.observers[0].observe).toHaveBeenCalledTimes(1)
  const before = h.fit.mock.calls.length
  h.observers[0].callback()
  expect(h.fit).toHaveBeenCalledTimes(before + 1)
  expect(h.invoke).toHaveBeenCalledWith('resize_terminal', { sessionId: 'session-1', rows: 35, cols: 100 })
  await act(async () => root?.unmount()); root = null
  expect(h.observers[0].disconnect).toHaveBeenCalledTimes(1)
  h.observers[0].callback()
  expect(h.fit).toHaveBeenCalledTimes(before + 1)
})

it.each(['observer', 'window'])('replays a resize during pending spawn from %s', async (source) => {
  const pending = deferred<string>()
  h.invoke.mockImplementation((name: string) => name === 'spawn_terminal' ? pending.promise : Promise.resolve())
  await act(async () => root?.render(<TerminalPanel workspace="/book" />))
  h.fit.mockImplementation(() => h.terms.at(-1)?.resize?.({ rows: 35, cols: 100 }))
  if (source === 'observer') h.observers[0].callback()
  else window.dispatchEvent(new Event('resize'))
  await act(async () => pending.resolve('session-1'))
  expect(h.invoke).toHaveBeenCalledWith('resize_terminal', { sessionId: 'session-1', rows: 35, cols: 100 })
})
