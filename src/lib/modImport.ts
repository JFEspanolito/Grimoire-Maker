import { open } from '@tauri-apps/plugin-dialog'
import { exists, mkdir, readDir, readFile, stat, writeFile } from '@tauri-apps/plugin-fs'
import { Unzip, UnzipInflate, UnzipPassThrough, strFromU8, strToU8 } from 'fflate'
import { ThemeAssetError, findRemoteCssReference, inlinePackAssets } from './cssGuard'
import { installExternalPlugin } from './externalPlugins'
import { MOD_KIND, type ModKind } from './modCatalog'
import { parseDocument } from './frontmatter'
import { prepareModLibrary } from './modLibrary'
import { firstSnippetTag, snippetCategory } from './snippetLibrary'
import { collectPackage, installPackage, type PackageFs } from './templateIo'
import { LIMITS, PackageError, packageIdFromFileName, sanitizePathSegment } from './templatePackage'
import { OFFICIAL_TEMPLATES } from './templates'
import { MAX_THEME_BYTES } from './themeDecorations'
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
    /[\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\u061c\ufeff]/.test(name) ||
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

function unpackZipEntries(bytes: Uint8Array, allowedExtensions?: ReadonlySet<string>, unwrap = true): Record<string, Uint8Array> {
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
  return unwrap ? unwrapSingleTopFolder(files) : files
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

/** Extensions a theme pack may hold: the stylesheet plus the fonts and images it refers to. */
const THEME_PACK_EXTENSIONS = new Set(['css', 'woff2', 'woff', 'ttf', 'otf', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'])
const MAX_SNIPPET_FILE_BYTES = 512 * 1024

/**
 * A theme pack is exactly one `theme.css` plus files under `assets/`. Its relative `url(assets/...)`
 * references are turned back into `data:` URIs so the installed theme is one self-contained file;
 * the usual validation then runs on that result.
 */
function themePackCss(files: Record<string, Uint8Array>): string | null {
  const stylesheets = Object.keys(files).filter((name) => name.toLowerCase().endsWith('.css'))
  if (stylesheets.length !== 1 || stylesheets[0] !== 'theme.css' || !Object.keys(files).some((name) => name.startsWith('assets/'))) return null
  const assets = Object.fromEntries(Object.entries(files).filter(([name]) => name.startsWith('assets/')))
  try {
    return inlinePackAssets(strFromU8(files['theme.css']), assets, { maxCssBytes: MAX_THEME_BYTES })
  } catch (error) {
    throw error instanceof ThemeAssetError ? new PackageError(error.message) : error
  }
}

type FileMap = Record<string, Uint8Array>

/**
 * A snippet pack made of category folders: every top-level entry is a folder, and either there are
 * several of them or the single one names itself as the category in its files' `tags`. Anything else
 * (loose files, or one wrapper folder) keeps the older meaning: the archive is one group.
 */
function snippetCategories(files: FileMap): string[] | null {
  const names = Object.keys(files)
  if (names.length === 0 || names.some((name) => !name.includes('/'))) return null
  const tops = [...new Set(names.map((name) => name.split('/')[0]))]
  if (tops.length > 1) return tops
  const folder = snippetCategory(tops[0]).toLowerCase()
  const declared = names.every((name) => {
    const tag = firstSnippetTag(parseDocument(strFromU8(files[name]).replace(/^﻿/, '')).frontmatter)
    return tag !== null && snippetCategory(tag).toLowerCase() === folder
  })
  return declared ? tops : null
}

/** The folder `name` inside `parent` (matched ignoring case, like Mod Manager does), created when missing. */
async function ensureGroupFolder(fs: PackageFs, parent: string, name: string): Promise<string> {
  const found = (await fs.readDir(parent)).find((entry) => entry.name.toLowerCase() === name.toLowerCase())
  if (found && (!found.isDirectory || found.isSymlink)) throw new PackageError(`${name}: expected a real folder, not a link or file`)
  const path = `${parent}/${found?.name ?? name}`
  if (!found) await fs.mkdir(path)
  return path
}

/** Writes `relative` under `folder` without replacing anything: `-2`, `-3`, ... is added to a taken name. */
async function writeUnique(fs: PackageFs, folder: string, relative: string, data: Uint8Array): Promise<void> {
  const segments = relative.split('/')
  let directory = folder
  for (const segment of segments.slice(0, -1)) directory = await ensureGroupFolder(fs, directory, segment)
  const file = segments[segments.length - 1]
  const dot = file.lastIndexOf('.')
  const stem = dot === -1 ? file : file.slice(0, dot)
  const extension = dot === -1 ? '' : file.slice(dot)
  const taken = new Set((await fs.readDir(directory)).map((entry) => entry.name.toLowerCase()))
  let name = file
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${stem}-${n}${extension}`
  await fs.writeFile(`${directory}/${name}`, data)
}

/** Installs one `.md` snippet under `Snippets/<group>/`; the group is its first tag, else its folder's name, else `Imported`. */
async function importSingleSnippet(fs: PackageFs, snippetsDir: string, path: string): Promise<string> {
  const bytes = await fs.readFile(path)
  if (bytes.length > MAX_SNIPPET_FILE_BYTES) throw new PackageError('The snippet file is larger than 512 KiB')
  const { frontmatter, body } = parseDocument(strFromU8(bytes).replace(/^﻿/, ''))
  if (!body.trim()) throw new PackageError('The snippet file is empty')
  const parts = path.split('/')
  const parent = parts.length >= 3 && !/^[A-Za-z]:$/.test(parts[parts.length - 2]) ? parts[parts.length - 2] : ''
  const group = snippetCategory(firstSnippetTag(frontmatter) ?? (parent || 'Imported'))
  if (!(await fs.exists(snippetsDir))) await fs.mkdir(snippetsDir)
  const folder = await ensureGroupFolder(fs, snippetsDir, group)
  const stem = sanitizePathSegment(parts[parts.length - 1].replace(/\.md$/i, ''), 'snippet')
  await writeUnique(fs, folder, `${stem}.md`, bytes)
  return group
}

/** Opens the native file or folder picker for the given import source and mod category. */
export async function pickModSource(source: ModImportSource, kind: ModKind): Promise<string | null> {
  if (source === 'folder') {
    const picked = await open({ directory: true, multiple: false })
    return typeof picked === 'string' ? picked.replaceAll('\\', '/') : null
  }
  const extensions = kind === MOD_KIND.THEMES ? ['zip', 'css']
    : kind === MOD_KIND.PLUGINS ? ['zip', 'gmp']
      : kind === MOD_KIND.SNIPPETS ? ['zip', 'md']
        : kind === MOD_KIND.TEMPLATES ? ['zip', 'gmtemplate'] : ['zip']
  const name = kind === MOD_KIND.THEMES ? 'Theme archive or CSS'
    : kind === MOD_KIND.PLUGINS ? 'Plugin package (.zip, .gmp)'
      : kind === MOD_KIND.SNIPPETS ? 'Snippet (.md) or snippet pack (.zip)'
        : kind === MOD_KIND.TEMPLATES ? 'Template package (.zip, .gmtemplate)' : 'Mod archive (.zip)'
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
    if (source === 'zip' && /\.md$/i.test(normalized)) return importSingleSnippet(fs, paths.snippets, normalized)
    const taken = await existingNames(fs, paths.snippets)
    const raw =
      source === 'zip'
        ? unpackZipEntries(await fs.readFile(normalized), new Set(['md']), false)
        : await collectDirectoryFiles(fs, normalized, new Set(['md']), 4)
    const categories = source === 'zip' ? snippetCategories(raw) : null
    if (categories) {
      // A pack of category folders: each category becomes its own group (not nested under the archive's name).
      const groups: string[] = []
      for (const top of categories) {
        const folder = await ensureGroupFolder(fs, paths.snippets, snippetCategory(top))
        groups.push(folder.slice(folder.lastIndexOf('/') + 1))
        for (const [name, data] of Object.entries(raw).sort(([a], [b]) => (a < b ? -1 : 1))) {
          if (name.startsWith(`${top}/`)) await writeUnique(fs, folder, name.slice(top.length + 1), data)
        }
      }
      return groups[0]
    }
    const resolved = source === 'zip' ? unwrapSingleTopFolder(raw) : raw
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

    const themeFiles =
      source === 'zip'
        ? unpackZipEntries(await fs.readFile(normalized), THEME_PACK_EXTENSIONS)
        : await collectDirectoryFiles(fs, normalized, THEME_PACK_EXTENSIONS, 2)
    const packCss = themePackCss(themeFiles)
    if (packCss !== null) return installThemeBytes(fs, paths.themes, taken, baseName, strToU8(packCss))
    const cssFiles = Object.fromEntries(Object.entries(themeFiles).filter(([name]) => name.toLowerCase().endsWith('.css')))
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
