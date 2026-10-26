import { describe, expect, it } from 'vitest'
import { isPristineCopy, resolveMigrations } from './migratedPlugins'
import type { ModEntry, ModFs } from './modCatalog'

/** A tiny in-memory file system: directories are implied by file paths. */
function memoryFs(files: Record<string, string>, links: string[] = []): ModFs {
  const names = (dir: string) => {
    const prefix = `${dir}/`
    const children = new Map<string, boolean>()
    for (const path of [...Object.keys(files), ...links]) {
      if (!path.startsWith(prefix)) continue
      const [first, ...rest] = path.slice(prefix.length).split('/')
      children.set(first, rest.length > 0)
    }
    return [...children].map(([name, isDirectory]) => ({ name, isDirectory, isSymlink: links.includes(`${prefix}${name}`) }))
  }
  return {
    exists: async (path) => path in files,
    mkdir: async () => {},
    readDir: async (dir) => names(dir),
    readTextFile: async (path) => {
      if (!(path in files)) throw new Error('missing')
      return files[path]
    },
    writeTextFile: async () => {},
    stat: async () => ({ size: 0 }),
  } as ModFs
}

const baseline = { 'zoom.tsx': 'export default {}\n', 'script.ts': 'export const steps = []\n', 'index.md': '# Zoom\n' }
const folder = '/mods/Plugins/zoom'
const shipped = (overrides: Record<string, string | null> = {}) => {
  const files: Record<string, string> = {}
  for (const [name, text] of Object.entries({ ...baseline, ...overrides })) if (text !== null) files[`${folder}/${name}`] = text
  return files
}

describe('isPristineCopy', () => {
  it('accepts the shipped files, ignoring line-ending differences only', async () => {
    expect(await isPristineCopy(memoryFs(shipped()), folder, baseline)).toBe(true)
    expect(await isPristineCopy(memoryFs(shipped({ 'zoom.tsx': 'export default {}\r\n' })), folder, baseline)).toBe(true)
  })

  it('ignores documentation: an older or edited Markdown file is not a code edit', async () => {
    expect(await isPristineCopy(memoryFs(shipped({ 'index.md': '# An older description' })), folder, baseline)).toBe(true)
    expect(await isPristineCopy(memoryFs(shipped({ 'index.md': null })), folder, baseline)).toBe(true)
    expect(await isPristineCopy(memoryFs({ ...shipped(), [`${folder}/NOTES.md`]: 'mine' }), folder, baseline)).toBe(true)
  })

  it('rejects an edited, missing, extra or linked file', async () => {
    expect(await isPristineCopy(memoryFs(shipped({ 'zoom.tsx': '// my change' })), folder, baseline)).toBe(false)
    expect(await isPristineCopy(memoryFs(shipped({ 'script.ts': null })), folder, baseline)).toBe(false)
    expect(await isPristineCopy(memoryFs({ ...shipped(), [`${folder}/notes.txt`]: 'mine' }), folder, baseline)).toBe(false)
    expect(await isPristineCopy(memoryFs(shipped(), [`${folder}/zoom.tsx`]), folder, baseline)).toBe(false)
  })

  it('treats an unreadable folder as edited', async () => {
    const broken = memoryFs(shipped())
    broken.readDir = async () => { throw new Error('denied') }
    expect(await isPristineCopy(broken, folder, baseline)).toBe(false)
  })
})

describe('resolveMigrations', () => {
  const mod = (overrides: Partial<ModEntry> = {}): ModEntry => ({
    id: 'Plugins/zoom', kind: 'Plugins', label: 'zoom', folder, enabled: true, errors: [], ...overrides,
  })
  const official = [{ folder: 'zoom', label: 'Zoom', files: baseline }]

  it('replaces an untouched enabled trusted copy and keeps its files', async () => {
    const outcome = await resolveMigrations(memoryFs(shipped()), [mod()], official)
    expect(outcome).toEqual({ replaced: ['Plugins/zoom'], localWins: [] })
  })

  it('lets an edited local copy win so the bundled version never overrides it', async () => {
    const outcome = await resolveMigrations(memoryFs(shipped({ 'zoom.tsx': '// edit' })), [mod()], official)
    expect(outcome).toEqual({ replaced: [], localWins: ['builtin.zoom'] })
  })

  it('does nothing when the trusted copy is absent or disabled', async () => {
    expect(await resolveMigrations(memoryFs({}), [], official)).toEqual({ replaced: [], localWins: [] })
    expect(await resolveMigrations(memoryFs(shipped({ 'zoom.tsx': '// edit' })), [mod({ enabled: false })], official))
      .toEqual({ replaced: [], localWins: [] })
  })
})
