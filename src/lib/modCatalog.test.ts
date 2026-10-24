import { describe, expect, it } from 'vitest'
import { discoverMods, seedExamples, type ModFs } from './modCatalog'

function memoryFs(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial))
  const folders = new Set(['/Mods', '/Mods/Templates', '/Mods/Snippets', '/Mods/Plugins'])
  for (const path of files.keys()) for (let at = path.lastIndexOf('/'); at > 0; at = path.lastIndexOf('/', at - 1)) folders.add(path.slice(0, at))
  const links = new Set<string>()
  const io: ModFs = {
    exists: async (path) => files.has(path) || folders.has(path),
    mkdir: async (path) => { folders.add(path) },
    writeTextFile: async (path, text) => { if (files.has(path)) throw new Error('exists'); files.set(path, text) },
    readTextFile: async (path) => { if (!files.has(path)) throw new Error('missing'); return files.get(path)! },
    stat: async (path) => ({ size: files.get(path)?.length ?? 0 }),
    readDir: async (path) => {
      if (!folders.has(path)) throw new Error('missing folder')
      return [...folders, ...files.keys()].filter((item) => item.slice(0, item.lastIndexOf('/')) === path)
        .map((item) => ({ name: item.slice(item.lastIndexOf('/') + 1), isDirectory: folders.has(item), isSymlink: links.has(item) }))
    },
  }
  return { io, files, folders, links }
}

describe('declarative mod folders', () => {
  it('uses configured directories without changing activation IDs or discovering Plugins', async () => {
    const { io } = memoryFs({
      '/Custom/Snippets/notes/one.md': '# Custom',
      '/Custom/Templates/book/index.md': '# Book',
      '/Mods/Snippets/old/one.md': '# Old',
      '/Custom/Plugins/executable/index.js': 'throw Error("never execute")',
    })
    const result = await discoverMods(io, '/Mods', ['Snippets/notes'], { Snippets: '/Custom/Snippets', Templates: '/Custom/Templates' })
    expect(result.mods.map(mod => mod.id)).toEqual(['Snippets/notes', 'Templates/book'])
    expect(result.mods[0].enabled).toBe(false)
    expect(result.snippets).toEqual([])
    expect(result.mods[1].folder).toBe('/Custom/Templates/book')
  })
  it('discovers Markdown groups and templates, never JavaScript plugins', async () => {
    const { io } = memoryFs({
      '/Mods/Templates/adventure/index.md': '---\ntemplateName: My Adventure\n---\n# Begin',
      '/Mods/Snippets/Dungeons and Dragons/loot.md': '---\nsnippetName: Loot table\n---\n## Loot',
      '/Mods/Snippets/Dungeons and Dragons/monsters/goblin.md': '## Goblin',
      '/Mods/Plugins/evil/index.js': 'throw new Error("executed")',
      '/Mods/Snippets/Dungeons and Dragons/ignored.js': 'throw new Error("executed")',
    })
    const result = await discoverMods(io, '/Mods', [])
    expect(result.mods.map((mod) => mod.label)).toEqual(['Dungeons and Dragons', 'My Adventure'])
    expect(result.snippets.map((snippet) => snippet.label)).toEqual(['Loot table', 'goblin'])
    expect(result.snippets[0].markdown).toBe('## Loot')
    expect(result.errors).toEqual([])
  })
  it('keeps disabled mods in the inventory but removes their snippets', async () => {
    const { io } = memoryFs({ '/Mods/Snippets/notes/note.md': '# Note' })
    const result = await discoverMods(io, '/Mods', ['Snippets/notes'])
    expect(result.mods[0].enabled).toBe(false)
    expect(result.snippets).toEqual([])
  })
  it('isolates broken packages and skips linked files and directories', async () => {
    const state = memoryFs({ '/Mods/Templates/broken/README.md': 'missing index', '/Mods/Snippets/good/link.md': '# outside', '/Mods/Snippets/good/ok.md': 'safe' })
    state.links.add('/Mods/Snippets/good/link.md')
    const result = await discoverMods(state.io, '/Mods', [])
    expect(result.snippets).toHaveLength(1)
    expect(result.snippets[0].markdown).toBe('safe')
    expect(result.errors.join()).toContain('index.md')
  })
  it('seeds once without overwriting community files or resurrecting deleted examples', async () => {
    const state = memoryFs({ '/Mods/Templates/example/index.md': 'customized' })
    const examples = { 'Templates/example/index.md': 'default', 'Snippets/demo/one.md': '# One' }
    await seedExamples(state.io, '/Mods', examples)
    expect(state.files.get('/Mods/Templates/example/index.md')).toBe('customized')
    expect(state.files.get('/Mods/Snippets/demo/one.md')).toBe('# One')
    state.files.delete('/Mods/Snippets/demo/one.md')
    await seedExamples(state.io, '/Mods', examples)
    expect(state.files.has('/Mods/Snippets/demo/one.md')).toBe(false)
  })
})
