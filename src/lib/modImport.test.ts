import { describe, expect, it, vi } from 'vitest'
import { zipSync } from 'fflate'
import { importModFromPath } from './modImport'
import type { PackageFs } from './templateIo'

vi.mock('./modLibrary', () => ({
  prepareModLibrary: vi.fn(async () => ({
    root: '/Mods',
    snippets: '/Mods/Snippets',
    templates: '/Mods/Templates',
    themes: '/Mods/Themes',
    plugins: '/Mods/Plugins',
    logs: '/logs',
    preferences: '/mods.json',
  })),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
  stat: vi.fn(async () => ({ size: 128 })),
  exists: vi.fn(),
  mkdir: vi.fn(),
  readDir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}))

function createMemoryPackageFs(initial: Record<string, Uint8Array> = {}) {
  const files = new Map<string, Uint8Array>(Object.entries(initial))
  const folders = new Set<string>(['/Mods', '/Mods/Snippets', '/Mods/Templates', '/Mods/Themes', '/Mods/Plugins'])
  for (const path of files.keys()) {
    for (let at = path.lastIndexOf('/'); at > 0; at = path.lastIndexOf('/', at - 1)) {
      folders.add(path.slice(0, at))
    }
  }
  const fs: PackageFs = {
    readFile: async (path) => {
      const data = files.get(path)
      if (!data) throw new Error(`Missing file: ${path}`)
      return data
    },
    writeFile: async (path, data) => {
      files.set(path, data)
    },
    mkdir: async (path) => {
      folders.add(path)
    },
    exists: async (path) => files.has(path) || folders.has(path),
    readDir: async (path) => {
      const items = new Set<string>()
      const out: { name: string; isDirectory: boolean }[] = []
      for (const dir of folders) {
        if (dir.slice(0, dir.lastIndexOf('/')) === path) {
          const name = dir.slice(dir.lastIndexOf('/') + 1)
          if (name && !items.has(name)) {
            items.add(name)
            out.push({ name, isDirectory: true })
          }
        }
      }
      for (const file of files.keys()) {
        if (file.slice(0, file.lastIndexOf('/')) === path) {
          const name = file.slice(file.lastIndexOf('/') + 1)
          if (name && !items.has(name)) {
            items.add(name)
            out.push({ name, isDirectory: false })
          }
        }
      }
      return out
    },
  }
  return { fs, files, folders }
}

const encode = (text: string) => new TextEncoder().encode(text)
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

describe('importModFromPath', () => {
  it('imports a snippet folder and a snippet zip into the configured Snippets directory', async () => {
    const zipBytes = zipSync({
      'pack/encounter.md': encode('## Encounter'),
    })
    const { fs, files } = createMemoryPackageFs({
      '/source/folder-snippets/npc.md': encode('## NPC'),
      '/source/zip-snippets.zip': zipBytes,
    })

    const folderId = await importModFromPath('/source/folder-snippets', 'folder', 'Snippets', fs)
    expect(folderId).toBe('folder-snippets')
    expect(decode(files.get('/Mods/Snippets/folder-snippets/npc.md')!)).toBe('## NPC')

    const zipId = await importModFromPath('/source/zip-snippets.zip', 'zip', 'Snippets', fs)
    expect(zipId).toBe('zip-snippets')
    expect(decode(files.get('/Mods/Snippets/zip-snippets/encounter.md')!)).toBe('## Encounter')
  })

  it('imports a theme CSS file or zip and normalizes its data-theme selector to match the installed id', async () => {
    const cssText = '/* @name: Crimson Scroll */\n[data-theme="old-id"] { --bg-primary: #111111; }'
    const { fs, files } = createMemoryPackageFs({
      '/downloads/crimson-scroll.css': encode(cssText),
    })

    const id = await importModFromPath('/downloads/crimson-scroll.css', 'zip', 'Themes', fs)
    expect(id).toBe('crimson-scroll')
    const installed = decode(files.get('/Mods/Themes/crimson-scroll.css')!)
    expect(installed).toContain('data-theme="crimson-scroll"')
  })
})
