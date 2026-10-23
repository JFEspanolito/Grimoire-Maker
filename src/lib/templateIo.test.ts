import { beforeEach, describe, expect, it } from 'vitest'
import { strFromU8, strToU8, zipSync } from 'fflate'
import { PackageError, createTemplateZip } from './templatePackage'
import { collectPackage, installPackage, type PackageFs } from './templateIo'

/** In-memory filesystem that records the order of writes. */
class FakeFs implements PackageFs {
  files = new Map<string, Uint8Array>()
  dirs = new Set<string>()
  writes: string[] = []
  symlinks = new Set<string>()
  mkdirs: string[] = []

  async readFile(path: string) {
    const data = this.files.get(path)
    if (!data) throw new Error(`ENOENT ${path}`)
    return data
  }
  async writeFile(path: string, data: Uint8Array) {
    this.files.set(path, data)
    this.writes.push(path)
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
