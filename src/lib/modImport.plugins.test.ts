import { zipSync, strToU8 } from 'fflate'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { importModFromPath } from './modImport'
import { installExternalPlugin, summarizeExternalPlugins } from './externalPlugins'
import type { PackageFs } from './templateIo'

vi.mock('./externalPlugins', async (original) => ({
  ...(await original<typeof import('./externalPlugins')>()),
  installExternalPlugin: vi.fn(async () => ({ id: 'community.zoom' })),
}))
vi.mock('./modLibrary', () => ({
  prepareModLibrary: vi.fn(async () => ({
    root: '/Mods', snippets: '/Mods/Snippets', templates: '/Mods/Templates', themes: '/Mods/Themes',
    plugins: '/Mods/Plugins', logs: '/logs', preferences: '/mods.json',
  })),
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))
vi.mock('@tauri-apps/plugin-fs', () => ({ stat: vi.fn(), exists: vi.fn(), mkdir: vi.fn(), readDir: vi.fn(), readFile: vi.fn(), writeFile: vi.fn() }))

function memoryFs(files: Record<string, Uint8Array>) {
  const written = new Map<string, Uint8Array>()
  const fs: PackageFs = {
    readFile: async (path) => files[path] ?? (() => { throw new Error(`Missing ${path}`) })(),
    writeFile: async (path, data) => { written.set(path, data) },
    mkdir: async () => {},
    exists: async (path) => path.startsWith('/Mods') && !path.startsWith('/Mods/Plugins/'),
    readDir: async (path) => path === '/src' ? [{ name: 'index.js', isDirectory: false }] : [],
  }
  return { fs, written }
}

beforeEach(() => vi.clearAllMocks())

describe('plugin imports', () => {
  it('sends a plugin zip to the native installer and never writes it into the trusted folder', async () => {
    const { fs, written } = memoryFs({ '/dl/zoom.zip': zipSync({ 'index.js': strToU8('export default {}') }) })
    expect(await importModFromPath('C:\\dl\\zoom.zip', 'zip', 'Plugins', fs)).toBe('community.zoom')
    expect(installExternalPlugin).toHaveBeenCalledWith('C:/dl/zoom.zip')
    expect(written.size).toBe(0)
  })

  it('keeps folder imports as an explicit local-trust copy', async () => {
    const { fs, written } = memoryFs({ '/src/index.js': strToU8('export default {}') })
    await importModFromPath('/src', 'folder', 'Plugins', fs)
    expect(installExternalPlugin).not.toHaveBeenCalled()
    expect([...written.keys()].some((path) => path.startsWith('/Mods/Plugins/'))).toBe(true)
  })

  it('does not route other mod kinds through the plugin installer', async () => {
    const { fs } = memoryFs({ '/dl/s.zip': zipSync({ 'a.md': strToU8('# a') }) })
    await importModFromPath('/dl/s.zip', 'zip', 'Snippets', fs)
    expect(installExternalPlugin).not.toHaveBeenCalled()
  })
})

describe('summarizeExternalPlugins', () => {
  it('describes the latest version and only calls it approved when current matches', () => {
    const base = { fingerprint: 'f', name: 'N', author: 'A', description: 'D', permissions: [], granted: [], installedAt: 1, source: 'import', signature: null }
    const registry = {
      version: 1,
      plugins: {
        a: { latest: '2', current: '1', state: 'installed', versions: [{ ...base, dir: '1', version: '1.0.0' }, { ...base, dir: '2', version: '1.1.0' }] },
        b: { latest: '1', current: '1', state: 'installed', versions: [{ ...base, dir: '1', version: '1.0.0' }] },
        c: { latest: 'gone', current: null, state: 'installed', versions: [] },
      },
    }
    const rows = summarizeExternalPlugins(registry)
    expect(rows.map((row) => [row.id, row.version, row.approved])).toEqual([['a', '1.1.0', false], ['b', '1.0.0', true]])
  })
})
