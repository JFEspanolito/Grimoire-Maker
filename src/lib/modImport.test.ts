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

describe('importModFromPath: single snippet files', () => {
  const snippet = (frontmatter: string, body = 'Body') => encode(`${frontmatter}${body}\n`)

  it('installs a .md under the group named by its first tag', async () => {
    const { fs, files } = createMemoryPackageFs({ '/downloads/goblin.md': snippet('---\nsnippetName: Goblin\ntags: [Dungeons and Dragons]\n---\n') })
    expect(await importModFromPath('/downloads/goblin.md', 'zip', 'Snippets', fs)).toBe('Dungeons and Dragons')
    expect(decode(files.get('/Mods/Snippets/Dungeons and Dragons/goblin.md')!)).toContain('snippetName: Goblin')
  })

  it('falls back to the parent folder name, then to Imported', async () => {
    const { fs, files } = createMemoryPackageFs({
      '/downloads/Monsters/orc.md': encode('Orc'),
      '/loose.md': encode('Loose'),
    })
    expect(await importModFromPath('/downloads/Monsters/orc.md', 'zip', 'Snippets', fs)).toBe('Monsters')
    expect(files.has('/Mods/Snippets/Monsters/orc.md')).toBe(true)
    expect(await importModFromPath('/loose.md', 'zip', 'Snippets', fs)).toBe('Imported')
    expect(files.has('/Mods/Snippets/Imported/loose.md')).toBe(true)
  })

  it('never overwrites and reuses an existing group ignoring case', async () => {
    const { fs, files } = createMemoryPackageFs({
      '/downloads/goblin.md': snippet('---\ntags: [monsters]\n---\n', 'New'),
      '/Mods/Snippets/Monsters/goblin.md': encode('Mine'),
    })
    await importModFromPath('/downloads/goblin.md', 'zip', 'Snippets', fs)
    expect(decode(files.get('/Mods/Snippets/Monsters/goblin.md')!)).toBe('Mine')
    expect(decode(files.get('/Mods/Snippets/Monsters/goblin-2.md')!)).toContain('New')
  })

  it('sanitizes a hostile tag and file name into one safe folder and file', async () => {
    const { fs, files } = createMemoryPackageFs({ '/downloads/x\u202e.md': snippet('---\ntags: ["../../Windows"]\n---\n') })
    await importModFromPath('/downloads/x\u202e.md', 'zip', 'Snippets', fs)
    const written = [...files.keys()].filter((path) => path.startsWith('/Mods/Snippets/'))
    expect(written).toHaveLength(1)
    expect(written[0]).toMatch(/^\/Mods\/Snippets\/[^/.]+\/[^/.\u202e]+\.md$/)
  })

  it('refuses an empty or oversized snippet file', async () => {
    const { fs } = createMemoryPackageFs({ '/downloads/empty.md': encode('---\ntags: [A]\n---\n  \n'), '/downloads/big.md': new Uint8Array(600 * 1024).fill(97) })
    await expect(importModFromPath('/downloads/empty.md', 'zip', 'Snippets', fs)).rejects.toThrow(/empty/)
    await expect(importModFromPath('/downloads/big.md', 'zip', 'Snippets', fs)).rejects.toThrow(/512 KiB/)
  })
})

describe('importModFromPath: snippet archives', () => {
  const tagged = (category: string, body: string) => encode(`---\nsnippetName: ${body}\ntags: [${category}]\n---\n${body}\n`)

  it('installs each top-level category folder as its own group', async () => {
    const { fs, files } = createMemoryPackageFs({
      '/dl/pack.zip': zipSync({ 'Monsters/goblin.md': encode('G'), 'Places/Deep/door.md': encode('D'), 'Places/gate.md': encode('P') }),
    })
    expect(await importModFromPath('/dl/pack.zip', 'zip', 'Snippets', fs)).toBe('Monsters')
    expect(decode(files.get('/Mods/Snippets/Monsters/goblin.md')!)).toBe('G')
    expect(decode(files.get('/Mods/Snippets/Places/Deep/door.md')!)).toBe('D')
    expect(decode(files.get('/Mods/Snippets/Places/gate.md')!)).toBe('P')
    expect(files.has('/Mods/Snippets/pack')).toBe(false)
  })

  it('keeps a single wrapper folder as one group named after the archive, as before', async () => {
    const { fs, files } = createMemoryPackageFs({ '/dl/my-pack.zip': zipSync({ 'wrapper/a.md': encode('A'), 'wrapper/b.md': encode('B') }) })
    expect(await importModFromPath('/dl/my-pack.zip', 'zip', 'Snippets', fs)).toBe('my-pack')
    expect(files.has('/Mods/Snippets/my-pack/a.md')).toBe(true)
  })

  it('treats a single folder as the category when its snippets say so in their tags', async () => {
    const { fs, files } = createMemoryPackageFs({ '/dl/anything.zip': zipSync({ 'Monsters/goblin.md': tagged('Monsters', 'G') }) })
    expect(await importModFromPath('/dl/anything.zip', 'zip', 'Snippets', fs)).toBe('Monsters')
    expect(files.has('/Mods/Snippets/Monsters/goblin.md')).toBe(true)
  })

  it('keeps loose files at the root, and mixed archives, as one group named after the archive', async () => {
    const { fs, files } = createMemoryPackageFs({
      '/dl/loose.zip': zipSync({ 'a.md': encode('A'), 'b.md': encode('B') }),
      '/dl/mixed.zip': zipSync({ 'a.md': encode('A'), 'Cat/b.md': encode('B'), 'Other/c.md': encode('C') }),
    })
    await importModFromPath('/dl/loose.zip', 'zip', 'Snippets', fs)
    expect(files.has('/Mods/Snippets/loose/b.md')).toBe(true)
    await importModFromPath('/dl/mixed.zip', 'zip', 'Snippets', fs)
    expect(files.has('/Mods/Snippets/mixed/Cat/b.md')).toBe(true)
  })

  it.each([
    ['a traversal entry', { 'Cat/../../evil.md': 'x' }],
    ['a backslash entry', { 'Cat\\evil.md': 'x' }],
    ['a device name', { 'Cat/NUL.md': 'x' }],
    ['a bidi control in the name', { 'Cat/a\u202eb.md': 'x' }],
    ['a zero-width character in a folder', { 'C\u200bat/a.md': 'x' }],
    ['an absolute path', { '/etc/evil.md': 'x' }],
    ['a drive path', { 'C:/evil.md': 'x' }],
  ])('refuses an archive with %s and writes nothing', async (_label, entries) => {
    const bytes = zipSync(Object.fromEntries(Object.entries(entries).map(([name, text]) => [name, encode(text)])))
    const { fs, files } = createMemoryPackageFs({ '/dl/bad.zip': bytes })
    const before = files.size
    await expect(importModFromPath('/dl/bad.zip', 'zip', 'Snippets', fs)).rejects.toThrow(/Unsafe path/)
    expect(files.size).toBe(before)
  })

  it('refuses names that differ only by case', async () => {
    const { fs } = createMemoryPackageFs({ '/dl/dup.zip': zipSync({ 'Cat/A.md': encode('1'), 'Cat/a.md': encode('2') }) })
    await expect(importModFromPath('/dl/dup.zip', 'zip', 'Snippets', fs)).rejects.toThrow(/Duplicate/)
  })

  it('skips hidden and non-Markdown entries and refuses an archive with nothing to import', async () => {
    const { fs, files } = createMemoryPackageFs({
      '/dl/some.zip': zipSync({ 'Cat/a.md': encode('A'), 'Cat/.hidden.md': encode('H'), 'Cat/script.js': encode('x'), 'Other/b.md': encode('B') }),
      '/dl/none.zip': zipSync({ 'Cat/script.js': encode('x') }),
    })
    await importModFromPath('/dl/some.zip', 'zip', 'Snippets', fs)
    expect([...files.keys()].filter((path) => path.startsWith('/Mods/Snippets/')).sort()).toEqual(['/Mods/Snippets/Cat/a.md', '/Mods/Snippets/Other/b.md'])
    await expect(importModFromPath('/dl/none.zip', 'zip', 'Snippets', fs)).rejects.toThrow(/No Markdown/)
  })

  it('skips symbolic links when importing a snippet folder', async () => {
    const { fs, files } = createMemoryPackageFs({ '/src/pack/real.md': encode('R'), '/src/pack/link.md': encode('L') })
    const readDir = fs.readDir
    fs.readDir = async (path) => (await readDir(path)).map((entry) => ({ ...entry, isSymlink: entry.name === 'link.md' }))
    await importModFromPath('/src/pack', 'folder', 'Snippets', fs)
    expect(files.has('/Mods/Snippets/pack/real.md')).toBe(true)
    expect(files.has('/Mods/Snippets/pack/link.md')).toBe(false)
  })
})

describe('importModFromPath: template packages with a manifest', () => {
  const manifest = (extra: Record<string, unknown> = {}) => JSON.stringify({ id: 'campaign-base', name: 'Campaign Base', version: '1.0.0', grimoireVersion: '>=0.1.0', ...extra })

  it('installs under the manifest id, labelled by its name, without copying template.json', async () => {
    const { fs, files } = createMemoryPackageFs({ '/dl/whatever.gmtemplate': zipSync({ 'template.json': encode(manifest()), 'Draft/One.md': encode('# One') }) })
    expect(await importModFromPath('/dl/whatever.gmtemplate', 'zip', 'Templates', fs)).toBe('campaign-base')
    expect(decode(files.get('/Mods/Templates/campaign-base/index.md')!)).toContain('templateName: Campaign Base')
    expect(files.has('/Mods/Templates/campaign-base/Draft/One.md')).toBe(true)
    expect(files.has('/Mods/Templates/campaign-base/template.json')).toBe(false)
  })

  it('makes the id unique when it is taken', async () => {
    const { fs } = createMemoryPackageFs({
      '/dl/a.zip': zipSync({ 'template.json': encode(manifest()), 'Draft/One.md': encode('# One') }),
      '/Mods/Templates/campaign-base/index.md': encode('x'),
    })
    expect(await importModFromPath('/dl/a.zip', 'zip', 'Templates', fs)).toBe('campaign-base-1')
  })

  it('refuses a template for a newer app before writing anything', async () => {
    const { fs, files } = createMemoryPackageFs({ '/dl/new.zip': zipSync({ 'template.json': encode(manifest({ grimoireVersion: '>=99.0.0' })), 'Draft/One.md': encode('# One') }) })
    const before = files.size
    await expect(importModFromPath('/dl/new.zip', 'zip', 'Templates', fs)).rejects.toThrow(/99\.0\.0/)
    expect(files.size).toBe(before)
  })

  it('still imports a classic zip with index.md and no manifest by its file name', async () => {
    const { fs, files } = createMemoryPackageFs({ '/dl/classic.zip': zipSync({ 'index.md': encode('---\ntemplateName: Classic\n---\n# Hi'), 'chapters/a.md': encode('# A') }) })
    expect(await importModFromPath('/dl/classic.zip', 'zip', 'Templates', fs)).toBe('classic')
    expect(files.has('/Mods/Templates/classic/chapters/a.md')).toBe(true)
  })
})
