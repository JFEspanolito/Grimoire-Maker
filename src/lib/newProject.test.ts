import { describe, expect, it, vi } from 'vitest'
import { DEMO_MARKDOWN, initializeProject } from './newProject'

function fixture(entries: string[] = []) {
  const paths = new Set(entries.map((name) => `/book/${name}`))
  const files = new Map<string, string>()
  const fs = {
    exists: async (path: string) => paths.has(path),
    readDir: async () => [...paths].filter((path) => !path.slice(6).includes('/')).map((path) => ({ name: path.slice(6) })),
    mkdir: vi.fn(async (path: string) => { paths.add(path) }),
    writeTextFile: vi.fn(async (path: string, content: string, options: { createNew: boolean }) => {
      if (options.createNew && files.has(path)) throw new Error('Already exists')
      files.set(path, content)
      paths.add(path)
    }),
  }
  return { fs, paths, files }
}

describe('new project demo', () => {
  it('creates the English chapter and original demo only once', async () => {
    const { fs, files, paths } = fixture(['.git'])
    const path = '/book/Draft/Chapter 1/Welcome.md'
    expect(await initializeProject(fs, '/book')).toBe(path)
    expect(files.get(path)).toBe(DEMO_MARKDOWN)
    expect(fs.writeTextFile).toHaveBeenCalledWith(path, DEMO_MARKDOWN, { createNew: true })
    expect(paths.has('/book/Research')).toBe(true)
    expect(paths.has('/book/Trash')).toBe(true)
    expect(await initializeProject(fs, '/book')).toBeNull()
    expect(fs.writeTextFile).toHaveBeenCalledTimes(1)
  })

  it.each([['existing.md'], ['Draft'], ['Research']])('does not seed an existing project with %s', async (entry) => {
    const { fs } = fixture([entry])
    expect(await initializeProject(fs, '/book')).toBeNull()
    expect(fs.writeTextFile).not.toHaveBeenCalled()
  })

  it('does not resurrect a deleted demo or chapter', async () => {
    const { fs, paths, files } = fixture()
    const path = await initializeProject(fs, '/book')
    paths.delete(path!)
    files.delete(path!)
    paths.delete('/book/Draft/Chapter 1')
    expect(await initializeProject(fs, '/book')).toBeNull()
    expect(files.size).toBe(0)
  })

  it('refuses to overwrite a file created concurrently', async () => {
    const { fs, files } = fixture()
    const path = '/book/Draft/Chapter 1/Welcome.md'
    files.set(path, 'Keep my writing')
    await expect(initializeProject(fs, '/book')).rejects.toThrow('Already exists')
    expect(files.get(path)).toBe('Keep my writing')
  })
})
