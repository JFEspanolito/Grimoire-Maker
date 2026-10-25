import { beforeEach, expect, it, vi } from 'vitest'
import { loadProjectSettings, saveProjectSettings } from './projectSettings'
const fs = vi.hoisted(() => ({ exists: vi.fn(), readTextFile: vi.fn(), writeTextFile: vi.fn(), rename: vi.fn() }))
vi.mock('@tauri-apps/plugin-fs', () => fs)
beforeEach(() => { vi.clearAllMocks(); fs.exists.mockResolvedValue(false); fs.writeTextFile.mockResolvedValue(undefined); fs.rename.mockResolvedValue(undefined) })
it('loads defaults only for a missing project file', async () => {
  expect(await loadProjectSettings('/book')).toEqual({ name: '', author: '', coAuthor: '' })
  fs.exists.mockResolvedValue(true); fs.readTextFile.mockResolvedValue('{broken')
  await expect(loadProjectSettings('/book')).rejects.toThrow()
})
it('saves only the chosen project and preserves unknown fields', async () => {
  fs.exists.mockResolvedValue(true)
  fs.readTextFile.mockResolvedValue(JSON.stringify({ author: 'Old', custom: 7 }))
  await saveProjectSettings('/book', { name: 'Book', author: 'Alice', coAuthor: 'Bob' })
  const [path, raw] = fs.writeTextFile.mock.calls[0]
  expect(path).toContain('/book/')
  expect(JSON.parse(raw)).toEqual({ name: 'Book', author: 'Alice', coAuthor: 'Bob', custom: 7 })
  expect(fs.rename).toHaveBeenCalledWith(path, '/book/.grimoire-project.json')
})
it('does not overwrite malformed metadata', async () => {
  fs.exists.mockResolvedValue(true); fs.readTextFile.mockResolvedValue('[]')
  await expect(saveProjectSettings('/book', { name: '', author: 'Alice', coAuthor: '' })).rejects.toThrow()
  expect(fs.writeTextFile).not.toHaveBeenCalled()
})

it('round-trips contributor lists and preserves legacy credits and unknown data', async () => {
  const artists = [{ name: 'Midrava', socialMedia: '@midrava', platform: 'Instagram' }]
  const coAuthors = [{ name: 'Writer', socialMedia: '@writer', platform: 'Bluesky' }]
  fs.exists.mockResolvedValue(true)
  fs.readTextFile.mockResolvedValue(JSON.stringify({ name: 'Book', author: 'Alice', coAuthor: 'Legacy', custom: 7, artists, coAuthors }))
  expect(await loadProjectSettings('/book')).toEqual({ name: 'Book', author: 'Alice', coAuthor: 'Legacy', artists, coAuthors })
  await saveProjectSettings('/book', { name: 'Book', author: 'Alice', coAuthor: 'Legacy', artists, coAuthors })
  expect(JSON.parse(fs.writeTextFile.mock.calls[0][1])).toEqual({ name: 'Book', author: 'Alice', coAuthor: 'Legacy', custom: 7, artists, coAuthors })
})
it('rejects invalid contributor lists without writing', async () => {
  fs.exists.mockResolvedValue(true)
  fs.readTextFile.mockResolvedValue(JSON.stringify({ artists: [{ name: '', socialMedia: '@x', platform: 'Instagram' }] }))
  await expect(loadProjectSettings('/book')).rejects.toThrow()
  await expect(saveProjectSettings('/book', { name: '', author: '', coAuthor: '' })).rejects.toThrow()
  expect(fs.writeTextFile).not.toHaveBeenCalled()
})

it('persists the document order and rejects paths that leave the project', async () => {
  fs.exists.mockResolvedValue(true)
  fs.readTextFile.mockResolvedValue(JSON.stringify({ author: 'Old' }))
  const documentOrder = { order: ['Draft/a.md', 'Draft/b.md'], excluded: ['Draft/b.md'] }
  await saveProjectSettings('/book', { name: '', author: 'Old', coAuthor: '', documentOrder })
  expect(JSON.parse(fs.writeTextFile.mock.calls[0][1]).documentOrder).toEqual(documentOrder)
  fs.readTextFile.mockResolvedValue(JSON.stringify({ documentOrder }))
  expect((await loadProjectSettings('/book')).documentOrder).toEqual(documentOrder)
  for (const bad of ['../x.md', '/abs.md', 'C:/x.md', 'a\\b.md']) {
    await expect(saveProjectSettings('/book', { name: '', author: '', coAuthor: '', documentOrder: { order: [bad], excluded: [] } })).rejects.toThrow()
  }
})
