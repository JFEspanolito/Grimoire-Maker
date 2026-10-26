import { describe, expect, it } from 'vitest'
import { isPristineCopy, migrateLegacyFolders, type MigrationFs } from './migratedPlugins'
import type { ModFs } from './modCatalog'

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

/** A mutable in-memory file system with rename; directories are implied by paths plus explicit mkdir. */
function writableFs(initial: Record<string, string>, options: { failRename?: boolean; failWrite?: (path: string) => boolean } = {}) {
  const files = new Map(Object.entries(initial))
  const dirs = new Set<string>()
  const view = (dir: string) => {
    const prefix = `${dir}/`
    const children = new Map<string, boolean>()
    for (const path of [...files.keys(), ...dirs]) {
      if (!path.startsWith(prefix)) continue
      const [first, ...rest] = path.slice(prefix.length).split('/')
      children.set(first, rest.length > 0 || dirs.has(path))
    }
    return [...children].map(([name, isDirectory]) => ({ name, isDirectory, isSymlink: false }))
  }
  const write = async (path: string, text: string) => {
    if (options.failWrite?.(path)) throw new Error('disk full')
    files.set(path, text)
  }
  const io: MigrationFs = {
    exists: async (path) => files.has(path) || dirs.has(path) || view(path).length > 0,
    mkdir: async (path) => { dirs.add(path) },
    readDir: async (dir) => view(dir),
    readTextFile: async (path) => {
      if (!files.has(path)) throw new Error('missing')
      return files.get(path)!
    },
    writeTextFile: async (path, text) => { if (files.has(path)) throw new Error('exists'); await write(path, text) },
    overwriteTextFile: write,
    stat: async () => ({ size: 0 }),
    rename: async (from, to) => {
      if (options.failRename) throw new Error('locked')
      files.set(to, files.get(from)!)
      files.delete(from)
    },
  }
  return { io, files }
}

describe('migrateLegacyFolders', () => {
  const pluginsDir = '/mods/Plugins'
  const legacy = [{ folder: 'zoom', label: 'Zoom', files: baseline }]
  const packageFiles = { 'manifest.json': '{"id":"builtin.zoom"}', 'dist/index.js': '', 'index.md': '# New docs' }
  const packages = [{ folder: 'zoom', label: 'Zoom', files: packageFiles }]
  const run = (io: MigrationFs) => migrateLegacyFolders(io, pluginsDir, legacy, packages)

  it('converts an untouched copy: package files written, old code moved to legacy/, documentation replaced', async () => {
    const { io, files } = writableFs(shipped())
    expect(await run(io)).toEqual({ converted: ['zoom'], errors: [] })
    expect(files.get(`${folder}/manifest.json`)).toBe(packageFiles['manifest.json'])
    expect(files.get(`${folder}/dist/index.js`)).toBe('')
    expect(files.get(`${folder}/index.md`)).toBe('# New docs')
    expect(files.get(`${folder}/legacy/zoom.tsx`)).toBe(baseline['zoom.tsx'])
    expect(files.get(`${folder}/legacy/script.ts`)).toBe(baseline['script.ts'])
    expect(files.has(`${folder}/zoom.tsx`)).toBe(false)
    expect(files.has(`${folder}/script.ts`)).toBe(false)
  })

  it('is a no-op the second time', async () => {
    const { io, files } = writableFs(shipped())
    await run(io)
    const after = new Map(files)
    expect(await run(io)).toEqual({ converted: [], errors: [] })
    expect(files).toEqual(after)
  })

  it('leaves an edited, extended or already packaged copy and a missing folder exactly as they are', async () => {
    for (const initial of [
      shipped({ 'zoom.tsx': '// my change' }),
      { ...shipped(), [`${folder}/notes.txt`]: 'mine' },
      { ...shipped(), [`${folder}/manifest.json`]: '{}' },
      {},
    ]) {
      const { io, files } = writableFs(initial)
      const before = new Map(files)
      expect(await run(io)).toEqual({ converted: [], errors: [] })
      expect(files).toEqual(before)
    }
  })

  it('never moves anything when the package files cannot be written, so the trusted copy keeps working', async () => {
    const { io, files } = writableFs(shipped(), { failWrite: (path) => path.endsWith('manifest.json') })
    const result = await run(io)
    expect(result.converted).toEqual([])
    expect(result.errors).toEqual([expect.stringContaining('Plugins/zoom: disk full')])
    expect(files.get(`${folder}/zoom.tsx`)).toBe(baseline['zoom.tsx'])
    expect(files.has(`${folder}/manifest.json`)).toBe(false)
  })

  it('reports a failed move but leaves a usable package', async () => {
    const { io, files } = writableFs(shipped(), { failRename: true })
    const result = await run(io)
    expect(result.converted).toEqual(['zoom'])
    expect(result.errors).toEqual([expect.stringContaining('moving the old files to legacy/ failed: locked')])
    expect(files.has(`${folder}/manifest.json`)).toBe(true)
    expect(files.get(`${folder}/zoom.tsx`)).toBe(baseline['zoom.tsx'])
  })
})
