import {
  LIMITS,
  PackageError,
  isPackageFile,
  packageIdFromFileName,
  readTemplateZip,
} from './templatePackage'
import { serializeDocument } from './frontmatter'
import type { Template } from './templates'

/** The filesystem operations package import and export need; injectable so they can be tested. */
export interface PackageFs {
  readFile(path: string): Promise<Uint8Array>
  writeFile(path: string, data: Uint8Array): Promise<void>
  /** Creates one folder; an existing folder is not an error. */
  mkdir(path: string): Promise<void>
  exists(path: string): Promise<boolean>
  readDir(path: string): Promise<{ name: string; isDirectory: boolean; isSymlink?: boolean }[]>
}

export interface ProjectPackageFs extends PackageFs {
  rename(from: string, to: string): Promise<void>
  removeDir(path: string): Promise<void>
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
      // A symlink can point anywhere on disk; following it would export files that are not in the package.
      if (entry.name.startsWith('.') || entry.isSymlink) continue
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

/** Materializes a template in Draft without replacing any existing project document. */
export async function createTemplateDocuments(fs: ProjectPackageFs, draft: string, template: Template): Promise<string> {
  if (!/^[A-Za-z0-9_-]+$/.test(template.id)) throw new PackageError('Invalid template id')
  let folder = `${draft}/${template.id}`
  for (let suffix = 1; await fs.exists(folder); suffix++) folder = `${draft}/${template.id}-${suffix}`
  const staging = `${draft}/.${template.id}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`

  const packageFiles = template.location?.kind === 'package'
    ? await collectPackage(fs, template.location.path)
    : {}
  const documents = Object.fromEntries(Object.entries(packageFiles).filter(([name]) =>
    (name.startsWith('chapters/') && /\.md$/i.test(name)) || name.startsWith('assets/')))
  documents['index.md'] = new TextEncoder().encode(serializeDocument(template.frontmatter, template.body))

  const folders = new Set<string>([staging])
  for (const name of Object.keys(documents)) {
    for (let at = name.indexOf('/'); at !== -1; at = name.indexOf('/', at + 1)) {
      folders.add(`${staging}/${name.slice(0, at)}`)
    }
  }
  try {
    for (const path of [...folders].sort((a, b) => a.length - b.length)) await fs.mkdir(path)
    for (const [name, bytes] of Object.entries(documents).sort(([a], [b]) => a.localeCompare(b))) {
      if (name !== 'index.md') await fs.writeFile(`${staging}/${name}`, bytes)
    }
    await fs.writeFile(`${staging}/index.md`, documents['index.md'])
    if (await fs.exists(folder)) throw new PackageError(`"${folder}" already exists`)
    await fs.rename(staging, folder)
  } catch (error) {
    try { await fs.removeDir(staging) } catch { /* Preserve the original write error. */ }
    throw error
  }
  const index = `${folder}/index.md`
  return index
}
