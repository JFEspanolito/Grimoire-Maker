import { beforeEach, describe, expect, it } from 'vitest'
import { strFromU8, strToU8, zipSync } from 'fflate'
import { PackageError, createTemplateZip } from './templatePackage'
import { collectPackage, createTemplateDocuments, installPackage, type PackageFs } from './templateIo'

/** In-memory filesystem that records the order of writes. */
class FakeFs implements PackageFs {
  files = new Map<string, Uint8Array>()
  dirs = new Set<string>()
  writes: string[] = []
  symlinks = new Set<string>()
  mkdirs: string[] = []
  failWriteSuffix: string | null = null

  async readFile(path: string) {
    const data = this.files.get(path)
    if (!data) throw new Error(`ENOENT ${path}`)
    return data
  }
  async writeFile(path: string, data: Uint8Array) {
    if (this.failWriteSuffix && path.endsWith(this.failWriteSuffix)) throw new Error('Disk full')
    this.files.set(path, data)
    this.writes.push(path)
  }
  async rename(from: string, to: string) {
    for (const [path, data] of [...this.files]) {
      if (path.startsWith(`${from}/`)) {
        this.files.delete(path)
        this.files.set(`${to}${path.slice(from.length)}`, data)
      }
    }
    for (const path of [...this.dirs]) {
      if (path === from || path.startsWith(`${from}/`)) {
        this.dirs.delete(path)
        this.dirs.add(`${to}${path.slice(from.length)}`)
      }
    }
  }
  async removeDir(path: string) {
    for (const file of [...this.files.keys()]) if (file.startsWith(`${path}/`)) this.files.delete(file)
    for (const dir of [...this.dirs]) if (dir === path || dir.startsWith(`${path}/`)) this.dirs.delete(dir)
  }
  async mkdir(path: string) {
    this.dirs.add(path)
    this.mkdirs.push(path)
  }
  async exists(path: string) {
    return this.files.has(path) || this.dirs.has(path)
  }
  async readDir(path: string) {
    const prefix = `${path}/`
    const names = new Map<string, boolean>()
    for (const file of this.files.keys()) {
      if (!file.startsWith(prefix)) continue
      const rest = file.slice(prefix.length)
      const slash = rest.indexOf('/')
      names.set(slash === -1 ? rest : rest.slice(0, slash), slash !== -1)
    }
    for (const dir of this.dirs) {
      if (dir.startsWith(prefix) && !dir.slice(prefix.length).includes('/')) names.set(dir.slice(prefix.length), true)
    }
    return [...names].map(([name, isDirectory]) => ({
      name,
      isDirectory,
      isSymlink: this.symlinks.has(`${path}/${name}`),
    }))
  }
}

const DIR = 'C:/cfg/templates'
const sample = (): Uint8Array =>
  zipSync({
    'index.md': strToU8('---\ntitle: T\n---\n# Hi\n'),
    'theme.css': strToU8("[data-theme='x'] {}"),
    'chapters/one.md': strToU8('# One'),
    'snippets/encounter.md': strToU8('## Encounter'),
    'assets/art/map.png': new Uint8Array([9, 8, 7]),
  })

let fs: FakeFs
beforeEach(() => {
  fs = new FakeFs()
})

describe('installPackage', () => {
  it('writes every file under a new folder named after the zip, nested folders included', async () => {
    const id = await installPackage(fs, DIR, 'My Adventure.zip', sample())
    expect(id).toBe('My-Adventure')
    expect([...fs.files.keys()].sort()).toEqual([
      `${DIR}/My-Adventure/assets/art/map.png`,
      `${DIR}/My-Adventure/chapters/one.md`,
      `${DIR}/My-Adventure/index.md`,
      `${DIR}/My-Adventure/snippets/encounter.md`,
      `${DIR}/My-Adventure/theme.css`,
    ])
    expect(strFromU8(fs.files.get(`${DIR}/My-Adventure/chapters/one.md`)!)).toBe('# One')
  })

  it('writes index.md last so an interrupted import is not mistaken for a valid template', async () => {
    await installPackage(fs, DIR, 'pack.zip', sample())
    expect(fs.writes.at(-1)).toBe(`${DIR}/pack/index.md`)
  })

  it('picks a free id when the folder already exists', async () => {
    fs.dirs.add(`${DIR}/pack`)
    expect(await installPackage(fs, DIR, 'pack.zip', sample())).toBe('pack-1')
  })

  it('also avoids the id of a single-file template', async () => {
    fs.files.set(`${DIR}/pack.md`, strToU8('# x'))
    expect(await installPackage(fs, DIR, 'pack.zip', sample())).toBe('pack-1')
  })

  it('writes nothing when the archive is refused', async () => {
    await expect(installPackage(fs, DIR, 'bad.zip', strToU8('not a zip'))).rejects.toBeInstanceOf(PackageError)
    expect(fs.writes).toEqual([])
    expect(fs.mkdirs).toEqual([])
  })
})

describe('collectPackage', () => {
  it('returns relative paths, skipping hidden files and types a package may not hold', async () => {
    const root = `${DIR}/pack`
    fs.files.set(`${root}/index.md`, strToU8('# Hi'))
    fs.files.set(`${root}/chapters/one.md`, strToU8('# One'))
    fs.files.set(`${root}/.DS_Store`, strToU8('x'))
    fs.files.set(`${root}/notes.exe`, strToU8('x'))
    expect(Object.keys(await collectPackage(fs, root)).sort()).toEqual(['chapters/one.md', 'index.md'])
  })

  it('never follows a symlink, which could export a file from outside the package', async () => {
    const root = `${DIR}/pack`
    fs.files.set(`${root}/index.md`, strToU8('# Hi'))
    fs.files.set(`${root}/secret.md`, strToU8('outside the package'))
    fs.symlinks.add(`${root}/secret.md`)
    expect(Object.keys(await collectPackage(fs, root))).toEqual(['index.md'])
  })

  it('exports what was imported', async () => {
    const id = await installPackage(fs, DIR, 'pack.zip', sample())
    const collected = await collectPackage(fs, `${DIR}/${id}`)
    const again = new FakeFs()
    await installPackage(again, DIR, 'copy.zip', createTemplateZip(collected))
    expect(Array.from(again.files.get(`${DIR}/copy/assets/art/map.png`)!)).toEqual([9, 8, 7])
    expect(again.files.size).toBe(fs.files.size)
  })
})

describe('createTemplateDocuments', () => {
  it('copies index, auxiliary chapters and assets into a unique Draft folder without copying package snippets', async () => {
    const packageRoot = `${DIR}/pack`
    fs.files.set(`${packageRoot}/index.md`, strToU8('# Start'))
    fs.files.set(`${packageRoot}/chapters/one.md`, strToU8('# One'))
    fs.files.set(`${packageRoot}/assets/map.png`, new Uint8Array([1, 2]))
    fs.files.set(`${packageRoot}/snippets/encounter.md`, strToU8('# Encounter'))
    fs.files.set(`${packageRoot}/theme.css`, strToU8('body {}'))
    fs.dirs.add('/project/Draft/pack')

    const index = await createTemplateDocuments(fs, '/project/Draft', {
      id: 'pack', label: 'Pack', frontmatter: { title: 'Adventure' }, body: '# Start', builtin: false,
      location: { kind: 'package', path: packageRoot },
    })

    expect(index).toBe('/project/Draft/pack-1/index.md')
    expect(fs.writes.at(-1)).toMatch(/\/index\.md$/)
    expect(strFromU8(fs.files.get('/project/Draft/pack-1/chapters/one.md')!)).toBe('# One')
    expect(Array.from(fs.files.get('/project/Draft/pack-1/assets/map.png')!)).toEqual([1, 2])
    expect(fs.files.has('/project/Draft/pack-1/snippets/encounter.md')).toBe(false)
    expect(fs.files.has('/project/Draft/pack-1/theme.css')).toBe(false)
    expect(fs.files.has('/project/Draft/pack/index.md')).toBe(false)
  })

  it('recreates the whole exported tree for a project-layout template, never the manifest, theme or snippets', async () => {
    const packageRoot = `${DIR}/pack`
    fs.files.set(`${packageRoot}/index.md`, strToU8('# Start'))
    fs.files.set(`${packageRoot}/Research/Notes.md`, strToU8('# Notes'))
    fs.files.set(`${packageRoot}/Chapter 1/Welcome.md`, strToU8('# Welcome'))
    fs.files.set(`${packageRoot}/Assets/map.png`, new Uint8Array([3, 4]))
    fs.files.set(`${packageRoot}/template.json`, strToU8('{}'))
    fs.files.set(`${packageRoot}/theme.css`, strToU8('body {}'))
    fs.files.set(`${packageRoot}/snippets/encounter.md`, strToU8('# Encounter'))

    await createTemplateDocuments(fs, '/project/Draft', {
      id: 'pack', label: 'Pack', frontmatter: {}, body: '# Start', builtin: false, layout: 'project',
      location: { kind: 'package', path: packageRoot },
    })

    expect(strFromU8(fs.files.get('/project/Draft/pack/Research/Notes.md')!)).toBe('# Notes')
    expect(strFromU8(fs.files.get('/project/Draft/pack/Chapter 1/Welcome.md')!)).toBe('# Welcome')
    expect(Array.from(fs.files.get('/project/Draft/pack/Assets/map.png')!)).toEqual([3, 4])
    for (const skipped of ['template.json', 'theme.css', 'snippets/encounter.md']) {
      expect(fs.files.has(`/project/Draft/pack/${skipped}`)).toBe(false)
    }
    expect(fs.writes.at(-1)).toMatch(/\/index\.md$/)
  })

  it('keeps copying only chapters and assets for a template without the project layout', async () => {
    const packageRoot = `${DIR}/pack`
    fs.files.set(`${packageRoot}/index.md`, strToU8('# Start'))
    fs.files.set(`${packageRoot}/Research/Notes.md`, strToU8('# Notes'))
    await createTemplateDocuments(fs, '/project/Draft', {
      id: 'pack', label: 'Pack', frontmatter: {}, body: '# Start', builtin: false,
      location: { kind: 'package', path: packageRoot },
    })
    expect(fs.files.has('/project/Draft/pack/Research/Notes.md')).toBe(false)
  })

  it('leaves no partial template folder when a file write fails', async () => {
    const packageRoot = `${DIR}/pack`
    fs.files.set(`${packageRoot}/index.md`, strToU8('# Start'))
    fs.files.set(`${packageRoot}/chapters/one.md`, strToU8('# One'))
    fs.failWriteSuffix = '/chapters/one.md'

    await expect(createTemplateDocuments(fs, '/project/Draft', {
      id: 'pack', label: 'Pack', frontmatter: {}, body: '# Start', builtin: false,
      location: { kind: 'package', path: packageRoot },
    })).rejects.toThrow('Disk full')

    expect([...fs.files.keys()].some((path) => path.startsWith('/project/Draft/'))).toBe(false)
    expect([...fs.dirs].some((path) => path.startsWith('/project/Draft/'))).toBe(false)
  })
})
