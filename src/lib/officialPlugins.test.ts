import { expect, it, vi } from 'vitest'
import type { ModEntry, ModFs } from './modCatalog'
import { installOfficialPlugin, listOfficialPlugins, missingOfficialPlugins } from './officialPlugins'

const examples = {
  'Plugins/zoom/index.md': '---\npluginName: Zoom\n---\n# Zoom',
  'Plugins/zoom/zoom.tsx': 'export default {}',
  'Plugins/bookmarks/index.md': '---\npluginName: Bookmarks\n---\n# Bookmarks',
  'Plugins/bookmarks/lib/anchors.ts': 'export {}',
  'Plugins/README.md': 'not a plugin',
  'Snippets/dnd/a.md': 'snippet',
}
const mod = (name: string): ModEntry => ({ id: `Plugins/${name}`, kind: 'Plugins', label: name, folder: `/p/${name}`, enabled: true, errors: [] })

it('groups the bundled examples into official plugins named by their frontmatter', () => {
  const plugins = listOfficialPlugins(examples)
  expect(plugins.map(plugin => [plugin.folder, plugin.label])).toEqual([['bookmarks', 'Bookmarks'], ['zoom', 'Zoom']])
  expect(Object.keys(plugins[0].files).sort()).toEqual(['index.md', 'lib/anchors.ts'])
})

it('reports the official plugins missing from the catalog', () => {
  const plugins = listOfficialPlugins(examples)
  expect(missingOfficialPlugins(plugins, [mod('zoom')]).map(plugin => plugin.folder)).toEqual(['bookmarks'])
  // Catalog ids are lower-cased, whatever the folder's own capitalisation.
  expect(missingOfficialPlugins(plugins, [mod('zoom'), { ...mod('bookmarks'), folder: '/p/Bookmarks' }])).toEqual([])
  expect(missingOfficialPlugins(plugins, [{ ...mod('zoom'), kind: 'Snippets' }]).map(plugin => plugin.folder)).toEqual(['bookmarks', 'zoom'])
})

it('restores a plugin with its nested folders and never replaces an existing file', async () => {
  const disk = new Map<string, string>([['/Plugins/bookmarks/index.md', 'edited by the user']])
  const directories = new Set(['/Plugins'])
  const io: ModFs = {
    exists: async path => disk.has(path) || directories.has(path),
    mkdir: vi.fn(async path => { directories.add(path) }),
    readDir: async path => [...directories].filter(item => item.startsWith(`${path}/`) && !item.slice(path.length + 1).includes('/'))
      .map(item => ({ name: item.slice(path.length + 1), isDirectory: true })),
    readTextFile: async path => disk.get(path)!,
    writeTextFile: async (path, text) => { disk.set(path, text) },
    stat: async () => ({ size: 0 }),
  }
  directories.add('/Plugins/bookmarks')
  await installOfficialPlugin(io, '/Plugins', listOfficialPlugins(examples)[0])
  expect(disk.get('/Plugins/bookmarks/index.md')).toBe('edited by the user')
  expect(disk.get('/Plugins/bookmarks/lib/anchors.ts')).toBe('export {}')
})
