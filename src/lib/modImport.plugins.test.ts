import { zipSync, strToU8 } from 'fflate'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { importModFromPath, pickModSource } from './modImport'
import { installExternalPlugin } from './externalPlugins'
import { prepareModLibrary } from './modLibrary'
import { open } from '@tauri-apps/plugin-dialog'
import type { PackageFs } from './templateIo'

vi.mock('./externalPlugins', () => ({ installExternalPlugin: vi.fn() }))
vi.mock('./modLibrary', () => ({ prepareModLibrary: vi.fn(async () => ({
  root: '/Mods', snippets: '/Mods/Snippets', templates: '/Mods/Templates', themes: '/Mods/Themes',
  plugins: '/Mods/Plugins', logs: '/logs', preferences: '/mods.json',
})) }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))
vi.mock('@tauri-apps/plugin-fs', () => ({ stat: vi.fn(), exists: vi.fn(), mkdir: vi.fn(), readDir: vi.fn(), readFile: vi.fn(), writeFile: vi.fn() }))

beforeEach(() => vi.clearAllMocks())

describe('official-only plugin policy', () => {
  it.each(['zip', 'folder'] as const)('rejects %s plugin imports before reading or preparing any files', async (source) => {
    const fs: PackageFs = { readFile: vi.fn(), writeFile: vi.fn(), mkdir: vi.fn(), exists: vi.fn(), readDir: vi.fn() }
    await expect(importModFromPath('/source/plugin', source, 'Plugins', fs)).rejects.toThrow('Only shipped official plugins are supported')
    expect(prepareModLibrary).not.toHaveBeenCalled()
    expect(installExternalPlugin).not.toHaveBeenCalled()
    for (const operation of Object.values(fs)) expect(operation).not.toHaveBeenCalled()
  })

  it.each(['zip', 'folder'] as const)('rejects the %s plugin picker before opening a dialog', async (source) => {
    await expect(pickModSource(source, 'Plugins')).rejects.toThrow('Only shipped official plugins are supported')
    expect(open).not.toHaveBeenCalled()
  })

  it('continues importing declarative snippets without invoking the plugin installer', async () => {
    const written: string[] = []
    const fs: PackageFs = {
      readFile: async () => zipSync({ 'a.md': strToU8('# a') }),
      writeFile: async (path) => { written.push(path) }, mkdir: async () => {},
      exists: async () => true, readDir: async () => [],
    }
    await importModFromPath('/dl/s.zip', 'zip', 'Snippets', fs)
    expect(written).toEqual(['/Mods/Snippets/s/a.md'])
    expect(installExternalPlugin).not.toHaveBeenCalled()
  })
})
