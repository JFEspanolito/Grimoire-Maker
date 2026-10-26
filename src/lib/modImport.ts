import { open } from '@tauri-apps/plugin-dialog'
import { exists, mkdir, readDir, readFile, stat, writeFile } from '@tauri-apps/plugin-fs'
import { Unzip, UnzipInflate, UnzipPassThrough, strFromU8 } from 'fflate'
import { findRemoteCssReference } from './cssGuard'
import { installExternalPlugin } from './externalPlugins'
import { MOD_KIND, type ModKind } from './modCatalog'
import { prepareModLibrary } from './modLibrary'
import { collectPackage, installPackage, type PackageFs } from './templateIo'
import { LIMITS, PackageError, packageIdFromFileName } from './templatePackage'
import { OFFICIAL_TEMPLATES } from './templates'
import { BUILTIN_THEMES } from './themes'

export type ModImportSource = 'folder' | 'zip'

const tauriPackageFs: PackageFs = {
  readFile,
  writeFile: (path, data) => writeFile(path, data),
  mkdir: (path) => mkdir(path, { recursive: true }),
  exists,
  readDir: async (path) =>
    (await readDir(path)).map((e) => ({ name: e.name, isDirectory: e.isDirectory, isSymlink: e.isSymlink })),
}

const SLICE_BYTES = 4 * 1024
const THEME_SELECTOR_RE = /data-theme\s*=\s*(?:"[^"]+"|'[^']+')/g

function isSafeRelativePath(name: string): boolean {
  const segments = name.split('/')
  if (
    name.startsWith('/') ||
    name.includes('\\') ||
    /^[a-zA-Z]:/.test(name) ||
    name.length > 200 ||
    /[<>"|?*]/.test(name) ||
    [...name].some((c) => c.charCodeAt(0) < 32)
  ) {
    return false
  }
  return !segments.some(
    (s) =>
      s === '' ||
      s === '.' ||
      s === '..' ||
      s.includes(':') ||
      s.length > 100 ||
      /[. ]$/.test(s) ||
      /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(s.split('.')[0]),
  )
}

function isJunkPath(name: string): boolean {
  return name.split('/').some((s) => s.startsWith('.') || s === '__MACOSX')
}

function unwrapSingleTopFolder(files: Record<string, Uint8Array>): Record<string, Uint8Array> {
  const names = Object.keys(files)
  if (names.length === 0) return files
  const first = names[0].split('/')[0]
  if (!first || !names.every((n) => n.startsWith(`${first}/`))) return files
  return Object.fromEntries(names.map((n) => [n.slice(first.length + 1), files[n]]))
}

function unpackZipEntries(bytes: Uint8Array, allowedExtensions?: ReadonlySet<string>): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {}
  let failure: PackageError | null = null
  let entries = 0
  let total = 0
  const seen = new Set<string>()
  const fail = (msg: string) => {
    failure ??= new PackageError(msg)
  }

  const unzipper = new Unzip()
  unzipper.register(UnzipInflate)
  unzipper.register(UnzipPassThrough)
  unzipper.onfile = (file) => {
    if (failure || file.name.endsWith('/')) return
    entries++
    if (entries > LIMITS.entries) return fail('The archive has too many files')
    if (!isSafeRelativePath(file.name)) return fail(`Unsafe path in archive: "${file.name}"`)
    if (isJunkPath(file.name)) return
    const dot = file.name.lastIndexOf('.')
    const ext = dot === -1 ? '' : file.name.slice(dot + 1).toLowerCase()
    if (allowedExtensions && !allowedExtensions.has(ext)) return
    if (seen.has(file.name.toLowerCase())) return fail(`Duplicate file in archive: "${file.name}"`)
    seen.add(file.name.toLowerCase())

    const chunks: Uint8Array[] = []
    let size = 0
    file.ondata = (error, chunk, final) => {
      if (failure) return
      if (error) return fail('The archive is damaged')
      total += chunk.length
      if (total > LIMITS.totalBytes) {
        fail('The archive is too large once unpacked')
        file.terminate()
        return
      }
      chunks.push(chunk)
      size += chunk.length
      if (final) {
        const out = new Uint8Array(size)
        let offset = 0
        for (const c of chunks) {
          out.set(c, offset)
          offset += c.length
        }
        files[file.name] = out
      }
    }
    file.start()
  }

  try {
    for (let at = 0; at < bytes.length && !failure; at += SLICE_BYTES) {
      unzipper.push(bytes.subarray(at, at + SLICE_BYTES), at + SLICE_BYTES >= bytes.length)
    }
  } catch {
    fail('Not a valid zip archive')
  }
  if (failure) throw failure
  if (entries === 0) throw new PackageError('Not a valid zip archive')
  return unwrapSingleTopFolder(files)
}

async function writeFileMap(fs: PackageFs, root: string, files: Record<string, Uint8Array>): Promise<void> {
  const folders = new Set<string>([root])
  for (const name of Object.keys(files)) {
    for (let at = name.indexOf('/'); at !== -1; at = name.indexOf('/', at + 1)) {
      folders.add(`${root}/${name.slice(0, at)}`)
    }
  }
  for (const folder of [...folders].sort((a, b) => a.length - b.length)) {
    await fs.mkdir(folder)
  }
  for (const name of Object.keys(files).sort()) {
    if (name !== 'index.md') await fs.writeFile(`${root}/${name}`, files[name])
  }
  if ('index.md' in files) {
    await fs.writeFile(`${root}/index.md`, files['index.md'])
  }
}

async function collectDirectoryFiles(
  fs: PackageFs,
  root: string,
  allowedExtensions?: ReadonlySet<string>,
  maxDepth = 4,
): Promise<Record<string, Uint8Array>> {
  const out: Record<string, Uint8Array> = {}
  let total = 0

  async function walk(dir: string, prefix: string, depth: number): Promise<void> {
    if (depth > maxDepth) return
    for (const entry of await fs.readDir(dir)) {
      if (entry.name.startsWith('.') || entry.isSymlink) continue
      const relative = `${prefix}${entry.name}`
      if (entry.isDirectory) {
        await walk(`${dir}/${entry.name}`, `${relative}/`, depth + 1)
        continue
      }
      const dot = entry.name.lastIndexOf('.')
      const ext = dot === -1 ? '' : entry.name.slice(dot + 1).toLowerCase()
      if (allowedExtensions && !allowedExtensions.has(ext)) continue
      const bytes = await fs.readFile(`${dir}/${entry.name}`)
      total += bytes.length
      if (Object.keys(out).length >= LIMITS.entries || total > LIMITS.totalBytes) {
        throw new PackageError('The selected folder is too large to import')
      }
      out[relative] = bytes
    }
  }

  await walk(root, '', 0)
  return out
}

async function existingNames(fs: PackageFs, dir: string, stripExt?: RegExp): Promise<Set<string>> {
  if (!(await fs.exists(dir))) await fs.mkdir(dir)
  const taken = new Set<string>()
  for (const entry of await fs.readDir(dir)) {
    const name = stripExt ? entry.name.replace(stripExt, '') : entry.name
    taken.add(name)
  }
  return taken
}

async function installThemeBytes(
  fs: PackageFs,
  themesDir: string,
  taken: Set<string>,
  rawName: string,
  bytes: Uint8Array,
): Promise<string> {
  const css = strFromU8(bytes)
  if (!/data-theme\s*=\s*(?:"[^"]+"|'[^']+')/.test(css)) {
    throw new PackageError('Theme stylesheet must include a [data-theme="..."] selector')
  }
  const remote = findRemoteCssReference(css)
  if (remote) {
    throw new PackageError(`Theme stylesheet references a remote resource (${remote})`)
  }
  const id = packageIdFromFileName(rawName.replace(/\.css$/i, ''), taken)
  taken.add(id)
  const normalizedCss = css.replace(THEME_SELECTOR_RE, `data-theme="${id}"`)
  await fs.writeFile(`${themesDir}/${id}.css`, new TextEncoder().encode(normalizedCss))
  return id
}

/** Opens the native file or folder picker for the given import source and mod category. */
export async function pickModSource(source: ModImportSource, kind: ModKind): Promise<string | null> {
  if (source === 'folder') {
    const picked = await open({ directory: true, multiple: false })
    return typeof picked === 'string' ? picked.replaceAll('\\', '/') : null
  }
  const extensions = kind === MOD_KIND.THEMES ? ['zip', 'css'] : kind === MOD_KIND.PLUGINS ? ['zip', 'gmp'] : ['zip']
  const name = kind === MOD_KIND.THEMES ? 'Theme archive or CSS' : kind === MOD_KIND.PLUGINS ? 'Plugin package (.zip, .gmp)' : 'Mod archive (.zip)'
  const picked = await open({ multiple: false, filters: [{ name, extensions }] })
  return typeof picked === 'string' ? picked.replaceAll('\\', '/') : null
}

/** Imports a mod from `sourcePath` (`folder` or `zip`) into the configured category directory. */
export async function importModFromPath(
  sourcePath: string,
  source: ModImportSource,
  kind: ModKind,
  fs: PackageFs = tauriPackageFs,
): Promise<string> {
  const normalized = sourcePath.replaceAll('\\', '/').replace(/\/$/, '')
  const baseName = normalized.slice(normalized.lastIndexOf('/') + 1)
  // A downloaded plugin package never reaches the trusted loader: native validation and managed
  // storage install it disabled and unverified. Folders stay a deliberate local-trust action.
  if (kind === MOD_KIND.PLUGINS && source === 'zip') return (await installExternalPlugin(normalized)).id
  const paths = await prepareModLibrary()

  if (kind === MOD_KIND.TEMPLATES) {
    if (!(await fs.exists(paths.templates))) await fs.mkdir(paths.templates)
    const reserved = OFFICIAL_TEMPLATES.map((t) => t.id)
    if (source === 'zip') {
      if ((await stat(normalized)).size > LIMITS.totalBytes) throw new PackageError('The archive is too large')
      return installPackage(fs, paths.templates, baseName, await fs.readFile(normalized), reserved)
    }
    const files = await collectPackage(fs, normalized)
    if (!('index.md' in files)) {
      throw new PackageError('The template folder needs an index.md at its top level')
    }
    for (const [name, data] of Object.entries(files)) {
      if (!name.toLowerCase().endsWith('.css')) continue
      const remote = findRemoteCssReference(strFromU8(data))
      if (remote) throw new PackageError(`${name} loads or hides remote resources (${remote})`)
    }
    const taken = await existingNames(fs, paths.templates, /\.md$/i)
    for (const id of reserved) taken.add(id)
    const id = packageIdFromFileName(baseName, taken)
    await writeFileMap(fs, `${paths.templates}/${id}`, files)
    return id
  }

  if (kind === MOD_KIND.SNIPPETS) {
    const taken = await existingNames(fs, paths.snippets)
    const files =
      source === 'zip'
        ? (() => {
            return fs.readFile(normalized).then((bytes) => unpackZipEntries(bytes, new Set(['md'])))
          })()
        : collectDirectoryFiles(fs, normalized, new Set(['md']), 4)
    const resolved = await files
    if (Object.keys(resolved).length === 0) {
      throw new PackageError('No Markdown (.md) snippet files were found to import')
    }
    const id = packageIdFromFileName(baseName, taken)
    await writeFileMap(fs, `${paths.snippets}/${id}`, resolved)
    return id
  }

  if (kind === MOD_KIND.THEMES) {
    const taken = await existingNames(fs, paths.themes, /\.css$/i)
    for (const builtin of BUILTIN_THEMES) taken.add(builtin.id)

    if (source === 'zip' && normalized.toLowerCase().endsWith('.css')) {
      const bytes = await fs.readFile(normalized)
      return installThemeBytes(fs, paths.themes, taken, baseName, bytes)
    }

    const cssFiles =
      source === 'zip'
        ? unpackZipEntries(await fs.readFile(normalized), new Set(['css']))
        : await collectDirectoryFiles(fs, normalized, new Set(['css']), 2)
    const entries = Object.entries(cssFiles)
    if (entries.length === 0) {
      throw new PackageError('No theme stylesheets (.css) were found to import')
    }
    let lastId = ''
    for (const [relName, bytes] of entries) {
      const fileName = relName.slice(relName.lastIndexOf('/') + 1)
      lastId = await installThemeBytes(fs, paths.themes, taken, fileName, bytes)
    }
    return lastId
  }

  // MOD_KIND.PLUGINS
  const taken = await existingNames(fs, paths.plugins)
  const pluginFiles =
    source === 'zip'
      ? unpackZipEntries(await fs.readFile(normalized))
      : await collectDirectoryFiles(fs, normalized)
  if (Object.keys(pluginFiles).length === 0) {
    throw new PackageError('No files were found in the selected plugin source')
  }
  const id = packageIdFromFileName(baseName, taken)
  await writeFileMap(fs, `${paths.plugins}/${id}`, pluginFiles)
  return id
}
