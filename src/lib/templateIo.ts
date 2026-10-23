import {
  LIMITS,
  PackageError,
  isPackageFile,
  packageIdFromFileName,
  readTemplateZip,
} from './templatePackage'

/** The filesystem operations package import and export need; injectable so they can be tested. */
export interface PackageFs {
  readFile(path: string): Promise<Uint8Array>
  writeFile(path: string, data: Uint8Array): Promise<void>
  /** Creates one folder; an existing folder is not an error. */
  mkdir(path: string): Promise<void>
  exists(path: string): Promise<boolean>
  readDir(path: string): Promise<{ name: string; isDirectory: boolean }[]>
}

/**
 * Unpacks a template zip into `<dir>/<id>/` and returns the id. The archive is fully
 * validated before the first byte is written. `index.md` goes last: a package cut short by
 * an I/O error has no index.md, so the loader reports it instead of treating it as valid.
 */
export async function installPackage(
  fs: PackageFs,
  dir: string,
  zipFileName: string,
  bytes: Uint8Array,
  reservedIds: Iterable<string> = [],
): Promise<string> {
  const files = readTemplateZip(bytes)

  const taken = new Set(reservedIds)
  for (const entry of await fs.readDir(dir)) taken.add(entry.name.replace(/\.md$/i, ''))
  const id = packageIdFromFileName(zipFileName, taken)
  const root = `${dir}/${id}`

  const folders = new Set<string>([root])
  for (const name of Object.keys(files)) {
    for (let at = name.indexOf('/'); at !== -1; at = name.indexOf('/', at + 1)) {
      folders.add(`${root}/${name.slice(0, at)}`)
    }
  }
  for (const folder of [...folders].sort((a, b) => a.length - b.length)) await fs.mkdir(folder)

  for (const name of Object.keys(files).sort()) {
    if (name !== 'index.md') await fs.writeFile(`${root}/${name}`, files[name])
  }
  await fs.writeFile(`${root}/index.md`, files['index.md'])
  return id
}

/** Reads a package folder into `relative path -> bytes`, ready for `createTemplateZip`. */
export async function collectPackage(fs: PackageFs, root: string): Promise<Record<string, Uint8Array>> {
  const out: Record<string, Uint8Array> = {}
  let total = 0

  async function walk(dir: string, prefix: string): Promise<void> {
    for (const entry of await fs.readDir(dir)) {
      if (entry.name.startsWith('.')) continue
      const relative = `${prefix}${entry.name}`
      if (entry.isDirectory) {
        await walk(`${dir}/${entry.name}`, `${relative}/`)
        continue
      }
      if (!isPackageFile(relative)) continue
      const data = await fs.readFile(`${dir}/${entry.name}`)
      total += data.length
      if (Object.keys(out).length >= LIMITS.entries || total > LIMITS.totalBytes) {
        throw new PackageError('This template is too large to export')
      }
      out[relative] = data
    }
  }

  await walk(root, '')
  return out
}
