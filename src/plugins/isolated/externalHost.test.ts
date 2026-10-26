import { afterEach, describe, expect, it, vi } from 'vitest'
import { listExternalPlugins, readExternalPluginEntry, setExternalPluginActive } from '../../lib/externalPlugins'
import type { ModEntry } from '../../lib/modCatalog'
import { registerPlugin, unregisterPlugin } from '../plugin-manager'
import { useModStore } from '../../stores/modStore'
import { applyLocalPackages, setExternalKillSwitch, startActiveExternalPlugins, startExternalPlugin, stopExternalPluginNow, useExternalRuntime } from './externalHost'
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

const entry = (id: string, origin: 'import' | 'local' = 'import', fingerprint = 'f') => ({ id, version: '1.0.0', fingerprint, sdkVersion: 1, permissions: [], toolbar: [], behaviors: [], overlays: [], tools: [], origin, source: '' })
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

describe('local package folders', () => {
  const mod = (folder: string, overrides: Partial<ModEntry> = {}): ModEntry =>
    ({ id: `Plugins/${folder}`, kind: 'Plugins', label: folder, folder: `/mods/Plugins/${folder}`, enabled: true, errors: [], package: true, ...overrides })
  const sync = (folder: string, id: string, fingerprint = 'f', changed = false) => ({ packages: [{ folder, id, version: '2.0.0', fingerprint, changed }], errors: [] })
  const registry = (id: string, state: string, folder: string, source = 'local') => vi.mocked(listExternalPlugins).mockResolvedValue({
    version: 1, disabledAll: false,
    plugins: { [id]: { latest: 'd', current: 'd', state, versions: [{ dir: 'd', source, localFolder: folder } as never] } },
  })

  it('activates and starts an enabled folder', async () => {
    registry('builtin.zoom', 'installed', 'zoom')
    vi.mocked(readExternalPluginEntry).mockResolvedValue(entry('builtin.zoom', 'local'))
    await applyLocalPackages([mod('zoom')], sync('zoom', 'builtin.zoom'))
    expect(setExternalPluginActive).toHaveBeenCalledWith('builtin.zoom', true)
    expect(running()).toEqual(['builtin.zoom'])
  })

  it('does nothing for a folder that is already active and running with the same bytes', async () => {
    registry('builtin.zoom', 'active', 'zoom')
    vi.mocked(readExternalPluginEntry).mockResolvedValue(entry('builtin.zoom', 'local'))
    await applyLocalPackages([mod('zoom')], sync('zoom', 'builtin.zoom'))
    await applyLocalPackages([mod('zoom')], sync('zoom', 'builtin.zoom'))
    expect(setExternalPluginActive).not.toHaveBeenCalled()
    expect(startPlugin).toHaveBeenCalledTimes(1)
  })

  it('stops a running plugin whose folder was switched off and records it as inactive', async () => {
    registry('builtin.zoom', 'active', 'zoom')
    vi.mocked(readExternalPluginEntry).mockResolvedValue(entry('builtin.zoom', 'local'))
    await applyLocalPackages([mod('zoom')], sync('zoom', 'builtin.zoom'))
    await applyLocalPackages([mod('zoom', { enabled: false })], sync('zoom', 'builtin.zoom'))
    expect(running()).toEqual([])
    expect(setExternalPluginActive).toHaveBeenCalledWith('builtin.zoom', false)
  })

  it('never starts a disabled folder', async () => {
    registry('builtin.zoom', 'installed', 'zoom')
    await applyLocalPackages([mod('zoom', { enabled: false })], sync('zoom', 'builtin.zoom'))
    expect(startPlugin).not.toHaveBeenCalled()
    expect(setExternalPluginActive).not.toHaveBeenCalled()
  })

  it('restarts a running plugin whose fingerprint changed', async () => {
    registry('builtin.zoom', 'active', 'zoom')
    vi.mocked(readExternalPluginEntry).mockResolvedValueOnce(entry('builtin.zoom', 'local', 'f')).mockResolvedValue(entry('builtin.zoom', 'local', 'g'))
    await applyLocalPackages([mod('zoom')], sync('zoom', 'builtin.zoom', 'f'))
    await applyLocalPackages([mod('zoom')], sync('zoom', 'builtin.zoom', 'g', true))
    expect(startPlugin).toHaveBeenCalledTimes(2)
    expect(running()).toEqual(['builtin.zoom'])
  })

  it('leaves a stopped plugin stopped until its files change', async () => {
    registry('builtin.zoom', 'stopped', 'zoom')
    vi.mocked(readExternalPluginEntry).mockResolvedValue(entry('builtin.zoom', 'local'))
    await applyLocalPackages([mod('zoom')], sync('zoom', 'builtin.zoom'))
    expect(startPlugin).not.toHaveBeenCalled()
    await applyLocalPackages([mod('zoom')], sync('zoom', 'builtin.zoom', 'g', true))
    expect(setExternalPluginActive).toHaveBeenCalledWith('builtin.zoom', true)
    expect(startPlugin).toHaveBeenCalledTimes(1)
  })

  it('stops what ran from a folder that no longer validates', async () => {
    registry('builtin.zoom', 'active', 'zoom')
    vi.mocked(readExternalPluginEntry).mockResolvedValue(entry('builtin.zoom', 'local'))
    await applyLocalPackages([mod('zoom')], sync('zoom', 'builtin.zoom'))
    await applyLocalPackages([mod('zoom')], { packages: [], errors: [{ folder: 'zoom', message: 'bad manifest' }] })
    expect(running()).toEqual([])
  })

  it('ignores trusted folders and survives a failing start', async () => {
    registry('builtin.zoom', 'installed', 'zoom')
    vi.mocked(readExternalPluginEntry).mockRejectedValue(new Error('integrity check failed'))
    await expect(applyLocalPackages([mod('mine', { package: undefined }), mod('zoom')], sync('zoom', 'builtin.zoom'))).resolves.toBeUndefined()
    expect(running()).toEqual([])
  })

  it('the emergency switch stops imported plugins but spares local ones', async () => {
    registry('builtin.zoom', 'active', 'zoom')
    vi.mocked(readExternalPluginEntry).mockImplementation(async (id) => entry(id, id === 'community.a' ? 'import' : 'local'))
    await applyLocalPackages([mod('zoom')], sync('zoom', 'builtin.zoom'))
    await startExternalPlugin('community.a')
    expect(running().sort()).toEqual(['builtin.zoom', 'community.a'])
    vi.mocked(listExternalPlugins).mockResolvedValue({
      version: 1, disabledAll: true,
      plugins: { 'builtin.zoom': { latest: 'd', current: 'd', state: 'active', versions: [{ dir: 'd', source: 'local', localFolder: 'zoom' } as never] } },
    })
    useModStore.setState({ ready: true, mods: [mod('zoom')] })
    await setExternalKillSwitch(true)
    expect(running()).toEqual(['builtin.zoom'])
  })

  it('startup skips a local plugin whose folder is switched off or gone', async () => {
    registry('builtin.zoom', 'active', 'zoom')
    vi.mocked(readExternalPluginEntry).mockResolvedValue(entry('builtin.zoom', 'local'))
    useModStore.setState({ ready: true, mods: [mod('zoom', { enabled: false })] })
    await startActiveExternalPlugins()
    useModStore.setState({ mods: [] })
    await startActiveExternalPlugins()
    expect(startPlugin).not.toHaveBeenCalled()
    useModStore.setState({ mods: [mod('zoom')] })
    await startActiveExternalPlugins()
    expect(running()).toEqual(['builtin.zoom'])
  })

  it('refuses to start beside a trusted plugin that already holds the id', async () => {
    registerPlugin({ id: 'builtin.zoom', name: 'Trusted', version: '1.0.0', activate: () => {} })
    vi.mocked(readExternalPluginEntry).mockResolvedValue(entry('builtin.zoom', 'local'))
    await expect(startExternalPlugin('builtin.zoom')).rejects.toThrow('A trusted plugin with this id is already loaded')
    expect(running()).toEqual([])
    unregisterPlugin('builtin.zoom')
  })
})
