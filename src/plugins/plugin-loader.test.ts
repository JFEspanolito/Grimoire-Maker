import { afterEach, expect, it, vi } from 'vitest'
import { reconcilePlugins } from './plugin-loader'
import { unregisterPlugin, usePluginRegistry } from './plugin-manager'
import { MOD_KIND, type ModEntry, type ModFs } from '../lib/modCatalog'

const io: ModFs = {
  exists: vi.fn(), mkdir: vi.fn(), writeTextFile: vi.fn(), stat: vi.fn(),
  readDir: vi.fn(async () => { throw new Error('Plugin source must not be read') }),
  readTextFile: vi.fn(async () => { throw new Error('Plugin source must not be read') }),
}
const mod = (name: string, enabled = true): ModEntry => ({
  id: `Plugins/${name}`, kind: MOD_KIND.PLUGINS, label: name,
  folder: `/plugins/${name}`, enabled, errors: [],
})
afterEach(async () => {
  await reconcilePlugins(io, [])
  for (const plugin of usePluginRegistry.getState().plugins) unregisterPlugin(plugin.id)
  vi.clearAllMocks()
})

it('registers all three shipped implementations without reading or transpiling local code', async () => {
  expect(await reconcilePlugins(io, ['bookmarks', 'zoom', 'pixel-ruler'].map(name => mod(name)))).toEqual([])
  expect(usePluginRegistry.getState().plugins.map(plugin => plugin.id).sort()).toEqual(['builtin.bookmarks', 'builtin.pixel-ruler', 'builtin.zoom'])
  expect(io.readTextFile).not.toHaveBeenCalled()
  expect(io.readDir).not.toHaveBeenCalled()
})

it('rejects unknown folders and spoofed official IDs without evaluating source', async () => {
  const errors = await reconcilePlugins(io, [mod('third-party'), { ...mod('bookmarks'), folder: '/plugins/third-party' }])
  expect(errors).toHaveLength(2)
  expect(errors.join(' ')).toContain('Only shipped official plugins are supported')
  expect(usePluginRegistry.getState().plugins).toEqual([])
  expect(io.readTextFile).not.toHaveBeenCalled()
})

it('ignores edited official files and keeps only one registration across rescans', async () => {
  vi.mocked(io.readTextFile).mockResolvedValue('throw new Error("untrusted source executed")')
  await reconcilePlugins(io, [mod('bookmarks')])
  const first = usePluginRegistry.getState().plugins[0]
  await reconcilePlugins(io, [mod('bookmarks')])
  expect(usePluginRegistry.getState().plugins).toEqual([first])
  expect(io.readTextFile).not.toHaveBeenCalled()
})

it('unloads disabled or removed official plugins and restores their contributions once', async () => {
  await reconcilePlugins(io, [mod('zoom', false)])
  expect(usePluginRegistry.getState().plugins).toEqual([])
  await reconcilePlugins(io, [mod('zoom')])
  expect(usePluginRegistry.getState().toolbar).toHaveLength(1)
  await reconcilePlugins(io, [mod('zoom', false)])
  expect(usePluginRegistry.getState().toolbar).toEqual([])
  await reconcilePlugins(io, [mod('zoom')])
  expect(usePluginRegistry.getState().toolbar).toHaveLength(1)
  await reconcilePlugins(io, [])
  expect(usePluginRegistry.getState().plugins).toEqual([])
  expect(usePluginRegistry.getState().toolbar).toEqual([])
})

it('serializes rapid enable and disable calls', async () => {
  await Promise.all([reconcilePlugins(io, [mod('zoom')]), reconcilePlugins(io, [])])
  expect(usePluginRegistry.getState().plugins).toEqual([])
})
