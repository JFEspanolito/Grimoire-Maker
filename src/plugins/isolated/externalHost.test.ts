import { afterEach, describe, expect, it, vi } from 'vitest'
import { readExternalPluginEntry, setExternalPluginActive } from '../../lib/externalPlugins'
import { setExternalKillSwitch, startExternalPlugin, stopExternalPluginNow, useExternalRuntime } from './externalHost'
import { startPlugin } from './runtime'

vi.mock('../../lib/externalPlugins', () => ({
  readExternalPluginEntry: vi.fn(),
  setExternalPluginActive: vi.fn(async () => {}),
  setExternalPluginsDisabled: vi.fn(async () => {}),
  stopExternalPlugin: vi.fn(async () => {}),
  logExternalPluginEvent: vi.fn(async () => {}),
  listExternalPlugins: vi.fn(),
}))
vi.mock('./probes', () => ({
  runIsolationProbes: async () => ({ ok: true, results: [], loop: { responsive: true, maxLagMs: 0, stopMs: 0 }, summary: 'ok' }),
}))
vi.mock('./runtime', () => ({
  startPlugin: vi.fn(async (options: { entry: { id: string }; onStopped(reason: string, detail: string): void }) => {
    const instance = {
      id: options.entry.id, generation: 1, running: true, emit: vi.fn(), command: vi.fn(),
      stop: vi.fn(() => { instance.running = false; options.onStopped('deactivated', '') }),
    }
    return instance
  }),
}))

const entry = (id: string) => ({ id, version: '1.0.0', fingerprint: 'f', sdkVersion: 1, permissions: [], toolbar: [], source: '' })
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
const running = () => useExternalRuntime.getState().running
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(async () => {
  await Promise.all(running().map((id) => stopExternalPluginNow(id)))
  vi.clearAllMocks()
})

describe('starting and stopping external plugins', () => {
  it('starts an active plugin once and stops it on deactivate', async () => {
    vi.mocked(readExternalPluginEntry).mockResolvedValue(entry('community.a'))
    await Promise.all([startExternalPlugin('community.a'), startExternalPlugin('community.a')])
    expect(running()).toEqual(['community.a'])
    expect(startPlugin).toHaveBeenCalledTimes(1)
    await stopExternalPluginNow('community.a')
    expect(running()).toEqual([])
    expect(setExternalPluginActive).toHaveBeenCalledWith('community.a', false)
  })

  it('does not run a plugin that was deactivated while its files were being read', async () => {
    const read = deferred<ReturnType<typeof entry>>()
    vi.mocked(readExternalPluginEntry).mockReturnValue(read.promise)
    const start = startExternalPlugin('community.b')
    await tick()
    await stopExternalPluginNow('community.b')
    read.resolve(entry('community.b'))
    await start
    expect(running()).toEqual([])
    expect(startPlugin).not.toHaveBeenCalled()
  })

  it('stops a plugin deactivated while its frame was being created', async () => {
    vi.mocked(readExternalPluginEntry).mockResolvedValue(entry('community.c'))
    const created = deferred<void>()
    vi.mocked(startPlugin).mockImplementationOnce(async (options) => {
      await created.promise
      const instance = {
        id: options.entry.id, generation: 1, running: true, emit: vi.fn(), command: vi.fn(),
        stop: vi.fn(() => { instance.running = false; options.onStopped('deactivated', '') }),
      }
      Reflect.set(globalThis, '__lastInstance', instance)
      return instance
    })
    const start = startExternalPlugin('community.c')
    await tick()
    await stopExternalPluginNow('community.c')
    created.resolve()
    await start
    expect(running()).toEqual([])
    const instance = Reflect.get(globalThis, '__lastInstance') as { running: boolean }
    expect(instance.running).toBe(false)
  })

  it('the emergency switch also reaches plugins that are still starting', async () => {
    const read = deferred<ReturnType<typeof entry>>()
    vi.mocked(readExternalPluginEntry).mockReturnValue(read.promise)
    const start = startExternalPlugin('community.d')
    await tick()
    await setExternalKillSwitch(true)
    read.resolve(entry('community.d'))
    await start
    expect(running()).toEqual([])
    expect(startPlugin).not.toHaveBeenCalled()
  })

  it('a stopped older start never removes the instance that replaced it', async () => {
    const first = deferred<ReturnType<typeof entry>>()
    vi.mocked(readExternalPluginEntry).mockReturnValueOnce(first.promise).mockResolvedValue(entry('community.e'))
    const stale = startExternalPlugin('community.e')
    await tick()
    await stopExternalPluginNow('community.e')
    await startExternalPlugin('community.e')
    expect(running()).toEqual(['community.e'])
    first.resolve(entry('community.e'))
    await stale
    expect(running()).toEqual(['community.e'])
  })
})
