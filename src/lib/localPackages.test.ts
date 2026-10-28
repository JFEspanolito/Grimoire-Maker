import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { folderName, sameFolder, syncLocalPackages } from './localPackages'
import { discoverMods, type ModFs } from './modCatalog'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

afterEach(() => { Reflect.deleteProperty(window, '__TAURI_INTERNALS__'); vi.resetAllMocks() })

it('asks the native side to sync the Plugins directory and returns its result', async () => {
  Reflect.set(window, '__TAURI_INTERNALS__', {})
  const result = {
    packages: [{ folder: 'zoom', id: 'builtin.zoom', version: '2.0.0', fingerprint: 'abc', changed: true }],
    errors: [{ folder: 'broken', message: 'manifest.json is invalid' }],
  }
  vi.mocked(invoke).mockResolvedValue(result)
  await expect(syncLocalPackages('/mods/Plugins')).resolves.toEqual(result)
  expect(invoke).toHaveBeenCalledWith('sync_local_plugin_packages', { pluginsDir: '/mods/Plugins' })
})

it('does nothing outside the desktop application', async () => {
  await expect(syncLocalPackages('/mods/Plugins')).resolves.toBeNull()
  expect(invoke).not.toHaveBeenCalled()
})

it('passes a native failure on to the caller', async () => {
  Reflect.set(window, '__TAURI_INTERNALS__', {})
  vi.mocked(invoke).mockRejectedValue(new Error('registry is locked'))
  await expect(syncLocalPackages('/mods/Plugins')).rejects.toThrow('registry is locked')
})

it('names folders by their last path segment, ignoring case when matching', () => {
  expect(folderName('H:\\Mods\\Plugins\\Zoom\\')).toBe('Zoom')
  expect(folderName('/mods/Plugins/pixel-ruler')).toBe('pixel-ruler')
  expect(sameFolder('Zoom', 'zoom')).toBe(true)
  expect(sameFolder('zoom', 'zoom2')).toBe(false)
})

/** A minimal file system where each key is a file and an entry listed in `links` is a symbolic link. */
function fsWith(files: string[], links: string[] = []): ModFs {
  const all = new Set(files)
  const folders = new Set<string>()
  for (const path of files) for (let at = path.lastIndexOf('/'); at > 0; at = path.lastIndexOf('/', at - 1)) folders.add(path.slice(0, at))
  return {
    exists: async (path) => all.has(path) || folders.has(path),
    mkdir: async () => {},
    writeTextFile: async () => {},
    readTextFile: async () => '',
    stat: async () => ({ size: 0 }),
    readDir: async (path) => [...new Set([...folders, ...all].filter((item) => item.slice(0, item.lastIndexOf('/')) === path))]
      .map((item) => ({ name: item.slice(item.lastIndexOf('/') + 1), isDirectory: folders.has(item), isSymlink: links.includes(item) })),
  }
}

beforeEach(() => vi.clearAllMocks())

it('marks a folder with a regular manifest.json as a package and gives it no missing-entry error', async () => {
  const io = fsWith([
    '/Mods/Plugins/zoom/manifest.json', '/Mods/Plugins/zoom/dist/index.js', '/Mods/Plugins/zoom/index.md',
    '/Mods/Plugins/mine/mine.tsx', '/Mods/Plugins/docs/index.md',
  ])
  const { mods, errors } = await discoverMods(io, '/Mods', [], { Plugins: '/Mods/Plugins' })
  const byFolder = Object.fromEntries(mods.map((mod) => [mod.label, mod]))
  expect(byFolder.zoom).toMatchObject({ package: true, errors: [] })
  expect(byFolder.mine.package).toBeUndefined()
  expect(byFolder.docs.package).toBeUndefined()
  expect(errors).toEqual(['Plugins/docs: This folder has documentation only; add a TSX, TS or JS plugin entry.'])
})

it('does not treat a linked manifest.json as a package', async () => {
  const io = fsWith(['/Mods/Plugins/linked/manifest.json', '/Mods/Plugins/linked/index.md'], ['/Mods/Plugins/linked/manifest.json'])
  const { mods } = await discoverMods(io, '/Mods', [], { Plugins: '/Mods/Plugins' })
  expect(mods.find((mod) => mod.label === 'linked')?.package).toBeUndefined()
})
