import { Unzip, UnzipInflate, UnzipPassThrough, strFromU8, strToU8, zipSync } from 'fflate'
import packageSource from '../../package.json?raw'
import { findRemoteCssReference } from './cssGuard'

/** The running application's version, from the one place it is declared. */
export const APP_VERSION = (JSON.parse(packageSource) as { version: string }).version

/** A template archive was refused; the message says why and is safe to show the user. */
export class PackageError extends Error {}

export const LIMITS = {
  entries: 500,
  /** Total inflated size across all files. */
  totalBytes: 50 * 1024 * 1024,
}

/**
 * Compressed bytes handed to the unzipper at a time. fflate inflates everything it is given
 * before reporting any output, so the slice size is what bounds memory: deflate expands at
 * most ~1000:1, so a 4 KB slice can produce ~4 MB before the size limit is checked.
 */
const SLICE_BYTES = 4 * 1024

/** Documents, styles and images only: a template package never needs to ship anything executable. */
const ALLOWED_EXTENSIONS = new Set(['md', 'txt', 'css', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'])

/** Windows treats these as devices whatever the extension, so writing one can hang or fail. */
const RESERVED_NAME = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i
const FORBIDDEN_CHARS = /[<>"|?*]/
/** Zero-width and bidirectional controls: they make a name read differently from what it is. */
const INVISIBLE_CHARS = /[\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\u061c\ufeff]/
const hasControlChars = (value: string): boolean => [...value].some((c) => c.charCodeAt(0) < 32)
const MAX_SEGMENT = 100
const MAX_PATH = 200

const isJunk = (segments: string[]): boolean =>
  segments.some((s) => s.startsWith('.') || s === '__MACOSX')

/** Rejects anything that could write outside the package folder. */
function checkPath(name: string): string[] {
  const segments = name.split('/')
  const unsafe =
    name.startsWith('/') ||
    name.includes('\\') ||
    /^[a-zA-Z]:/.test(name) ||
    name.length > MAX_PATH ||
    FORBIDDEN_CHARS.test(name) ||
    INVISIBLE_CHARS.test(name) ||
    hasControlChars(name) ||
    segments.some(
      (s) =>
        s === '' ||
        s === '.' ||
        s === '..' ||
        s.includes(':') ||
        s.length > MAX_SEGMENT ||
        /[. ]$/.test(s) ||
        RESERVED_NAME.test(s.split('.')[0]),
    )
  if (unsafe) throw new PackageError(`Unsafe path in archive: "${name}"`)
  return segments
}

/** Whether `name` passes the same path rules the importer applies to every archive entry. */
export function isSafePackagePath(name: string): boolean {
  try {
    checkPath(name)
    return true
  } catch {
    return false
  }
}

const INVISIBLE_GLOBAL = new RegExp(INVISIBLE_CHARS.source, 'g')
const CONTROL_GLOBAL = /[\u0000-\u001f\u007f-\u009f]+/g

/** One line of user text: no control, zero-width or bidirectional characters, single spaces, bounded. */
export function cleanLine(value: string, max: number): string {
  return value.normalize('NFC').replace(INVISIBLE_GLOBAL, '').replace(CONTROL_GLOBAL, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim()
}

/**
 * A single file or folder name made from free text. Anything outside letters, digits, `_` and `-`
 * (and spaces, when `spaces` is set, together with parentheses) becomes a separator, so the result can
 * never carry a path separator, a dot, a device name or an invisible character.
 */
export function sanitizePathSegment(value: string, fallback: string, { max = 80, spaces = false } = {}): string {
  const allowed = spaces ? /[^\p{L}\p{M}\p{N} _()-]+/gu : /[^\p{L}\p{M}\p{N}_-]+/gu
  let out = cleanLine(value, 4 * max).replace(allowed, spaces ? ' ' : '-')
  out = out.replace(/ {2,}/g, ' ').replace(/-{2,}/g, '-').replace(/^[-_ ]+|[-_ ]+$/g, '').slice(0, max).replace(/^[-_ ]+|[-_ ]+$/g, '')
  if (RESERVED_NAME.test(out)) out = `${out}-1`
  return out || fallback
}

/** A lowercase `a-z0-9-` slug, the form template ids take. */
export function slugify(value: string, fallback: string, max = 60): string {
  let out = value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/, '')
  if (RESERVED_NAME.test(out)) out = `template-${out}`
  return out || fallback
}

/**
 * A single-line YAML scalar that cannot break out of its line or key: plain when it is plainly safe,
 * otherwise quoted. Callers pass one line; any line break is flattened to a space first.
 */
export function yamlScalar(value: string): string {
  const v = value.replace(/[\r\n\u2028\u2029]+/g, ' ')
  const plain = /^[\p{L}\p{N}][\p{L}\p{N} _().-]*$/u.test(v) && v.trim() === v && Number.isNaN(Number(v))
    && !/^(true|false|null|yes|no|on|off)$/i.test(v)
  if (plain) return v
  if (!v.includes("'")) return `'${v}'`
  if (!v.includes('"') && !v.includes('\\')) return `"${v}"`
  return JSON.stringify(v)
}

/** Whether a package-relative path is something a template package may contain. */
export function isPackageFile(relativePath: string): boolean {
  return !isJunk(relativePath.split('/')) && ALLOWED_EXTENSIONS.has(extensionOf(relativePath))
}

/** The extension, or '' when the name has no dot (a file called just `css` is not a stylesheet). */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
}

function concat(chunks: Uint8Array[], length: number): Uint8Array {
  const out = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

/** If every file sits in one top-level folder (a zipped folder), treats that folder as the root. */
function unwrap(files: Record<string, Uint8Array>): Record<string, Uint8Array> {
  const names = Object.keys(files)
  if (names.length === 0 || 'index.md' in files) return files
  const first = names[0].split('/')[0]
  if (!names.every((n) => n.startsWith(`${first}/`))) return files
  return Object.fromEntries(names.map((n) => [n.slice(first.length + 1), files[n]]))
}

/* ---- template.json: the manifest a shared template carries at its root ------------------------- */

export const MANIFEST_NAME = 'template.json'
const MANIFEST_KEYS = new Set(['id', 'name', 'version', 'grimoireVersion', 'author', 'rootDirectory', 'description', 'structure'])
const MAX_MANIFEST_BYTES = 256 * 1024
const MAX_STRUCTURE_ENTRIES = 2 * LIMITS.entries + 64

export interface TemplateManifest {
  id: string
  name: string
  version: string
  grimoireVersion?: string
  author?: string
  rootDirectory?: string
  description?: string
  /** Advisory only: the files in the archive are the truth. */
  structure?: { path: string; type: 'file' | 'directory' }[]
}

const isManifestPath = (name: string): boolean => name === MANIFEST_NAME || name.endsWith(`/${MANIFEST_NAME}`)

/** `1.2.3` -> [1, 2, 3]; anything else (including a prerelease tail) compares by its numeric core. */
function versionParts(version: string): [number, number, number] | null {
  const match = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})/.exec(version)
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

function olderThan(running: string, required: string): boolean {
  const have = versionParts(running)
  const need = versionParts(required)
  if (!have || !need) return false
  for (let i = 0; i < 3; i++) if (have[i] !== need[i]) return have[i] < need[i]
  return false
}

function manifestText(value: unknown, key: string, { max, required = false, multiline = false }: { max: number; required?: boolean; multiline?: boolean }): string | undefined {
  if (value === undefined) {
    if (required) throw new PackageError(`template.json needs a "${key}"`)
    return undefined
  }
  if (typeof value !== 'string') throw new PackageError(`template.json: "${key}" must be text`)
  const control = multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/
  if (control.test(value) || INVISIBLE_CHARS.test(value)) throw new PackageError(`template.json: "${key}" contains control or invisible characters`)
  if (value.length > max) throw new PackageError(`template.json: "${key}" is longer than ${max} characters`)
  if (required && !value.trim()) throw new PackageError(`template.json needs a "${key}"`)
  return value
}

/**
 * Validates a template manifest strictly: a plain object, known keys only, bounded text, a semantic
 * `version` and, when present, a `grimoireVersion` of the form `>=x.y.z` that the running app satisfies.
 * `structure` is advisory, so only its shape is checked.
 */
export function parseTemplateManifest(bytes: Uint8Array, running: string = APP_VERSION): TemplateManifest {
  if (bytes.length > MAX_MANIFEST_BYTES) throw new PackageError('template.json is too large')
  let value: unknown
  try {
    value = JSON.parse(strFromU8(bytes))
  } catch {
    throw new PackageError('template.json is not valid JSON')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PackageError('template.json must be an object')
  const raw = value as Record<string, unknown>
  for (const key of Object.keys(raw)) {
    if (!MANIFEST_KEYS.has(key)) throw new PackageError(`template.json has an unknown field: "${key.slice(0, 40)}"`)
  }
  const id = manifestText(raw.id, 'id', { max: 80, required: true })!
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new PackageError('template.json: "id" may only use letters, numbers, "-" and "_"')
  const name = manifestText(raw.name, 'name', { max: 120, required: true })!.trim()
  const version = manifestText(raw.version, 'version', { max: 40, required: true })!
  if (!/^\d{1,6}\.\d{1,6}\.\d{1,6}(?:[-+][0-9A-Za-z.-]{1,30})?$/.test(version)) {
    throw new PackageError('template.json: "version" must look like 1.0.0')
  }
  const grimoireVersion = manifestText(raw.grimoireVersion, 'grimoireVersion', { max: 40 })
  if (grimoireVersion !== undefined) {
    const match = /^>=\s?(\d{1,6}\.\d{1,6}\.\d{1,6})$/.exec(grimoireVersion)
    if (!match) throw new PackageError('template.json: "grimoireVersion" must look like ">=1.0.0"')
    if (olderThan(running, match[1])) {
      throw new PackageError(`This template needs Grimoire Maker ${match[1]} or newer; this is version ${running}. Update the app and try again.`)
    }
  }
  const author = manifestText(raw.author, 'author', { max: 120 })
  const rootDirectory = manifestText(raw.rootDirectory, 'rootDirectory', { max: 100 })
  const description = manifestText(raw.description, 'description', { max: 2000, multiline: true })
  let structure: TemplateManifest['structure']
  if (raw.structure !== undefined) {
    const list = raw.structure
    if (!Array.isArray(list) || list.length > MAX_STRUCTURE_ENTRIES) throw new PackageError('template.json: "structure" must be a list of files and folders')
    structure = list.map((entry) => {
      const item = entry as Record<string, unknown> | null
      if (!item || typeof item !== 'object' || typeof item.path !== 'string' || item.path.length > 400
        || (item.type !== 'file' && item.type !== 'directory') || Object.keys(item).some((k) => k !== 'path' && k !== 'type')) {
        throw new PackageError('template.json: every "structure" entry needs a "path" and a "type" of file or directory')
      }
      return { path: item.path, type: item.type }
    })
  }
  return {
    id, name, version,
    ...(grimoireVersion !== undefined && { grimoireVersion }),
    ...(author !== undefined && { author }),
    ...(rootDirectory !== undefined && { rootDirectory }),
    ...(description !== undefined && { description }),
    ...(structure && { structure }),
  }
}

/** Gives index.md a `templateName` (the label Mod Manager shows) without disturbing anything else in it. */
function withTemplateName(index: Uint8Array | undefined, manifest: TemplateManifest): Uint8Array {
  // `templateLayout: project` tells the app to recreate the whole exported tree when the template is applied.
  const label = `templateName: ${yamlScalar(manifest.name)}\ntemplateLayout: project`
  const description = manifest.description ? `\ndescription: ${yamlScalar(manifest.description.replace(/\s+/g, ' ').trim())}` : ''
  if (!index) return strToU8(`---\n${label}${description}\n---\n# ${manifest.name.replace(/[\r\n]+/g, ' ')}\n`)
  const text = strFromU8(index)
  const fence = /^(﻿?---[^\S\r\n]*\r?\n)([\s\S]*?\r?\n)?(---[^\S\r\n]*(?:\r?\n|$))/.exec(text)
  if (!fence) return strToU8(`---\n${label}\n---\n${text}`)
  if (/^templateName\s*:/m.test(fence[2] ?? '')) return index
  return strToU8(`${fence[1]}${label}\n${text.slice(fence[1].length)}`)
}

export interface ReadOptions {
  limits?: typeof LIMITS
  /** Filled in as data is inflated, so callers (and tests) can see how much work a hostile archive caused. */
  stats?: { inflated: number }
}

/**
 * Reads and validates a template package. The archive is untrusted: paths are
 * checked before anything is inflated, inflation is capped (declared sizes are not
 * trusted), and only a fixed set of file types is kept.
 */
export function readTemplateZip(bytes: Uint8Array, options: ReadOptions = {}): Record<string, Uint8Array> {
  return readTemplatePackage(bytes, options).files
}

/**
 * Like `readTemplateZip`, and also returns the validated `template.json` when the archive has one at
 * its root. Such an archive does not need an `index.md`: a minimal one is made from the manifest.
 */
export function readTemplatePackage(
  bytes: Uint8Array,
  { limits = LIMITS, stats }: ReadOptions = {},
): { files: Record<string, Uint8Array>; manifest: TemplateManifest | null } {
  const files: Record<string, Uint8Array> = {}
  let failure: PackageError | null = null
  let entries = 0
  let total = 0
  const seen = new Set<string>()

  const fail = (message: string): void => {
    failure ??= new PackageError(message)
  }

  const unzipper = new Unzip()
  unzipper.register(UnzipInflate)
  unzipper.register(UnzipPassThrough)
  unzipper.onfile = (file) => {
    if (failure || file.name.endsWith('/')) return
    entries++
    if (entries > limits.entries) return fail('The archive has too many files')
    try {
      const segments = checkPath(file.name)
      if (isJunk(segments)) return
      // Case-insensitive filesystems would merge these into one file.
      if (seen.has(file.name.toLowerCase())) return fail(`Duplicate file in archive: "${file.name}"`)
      seen.add(file.name.toLowerCase())
      // template.json is the one JSON file a package may carry; where it sits is checked once the layout is known.
      if (!ALLOWED_EXTENSIONS.has(extensionOf(file.name)) && !(isManifestPath(file.name) && segments.length <= 2)) {
        return fail(`File type not allowed in a template: "${file.name}"`)
      }
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }

    const chunks: Uint8Array[] = []
    let size = 0
    file.ondata = (error, chunk, final) => {
      if (failure) return
      if (error) return fail('The archive is damaged')
      if (stats) stats.inflated += chunk.length
      total += chunk.length
      if (total > limits.totalBytes) {
        fail('The archive is too large once unpacked')
        file.terminate()
        return
      }
      chunks.push(chunk)
      size += chunk.length
      if (final) files[file.name] = concat(chunks, size)
    }
    file.start()
  }

  try {
    // Slice the input and stop at the first failure: see SLICE_BYTES.
    for (let at = 0; at < bytes.length && !failure; at += SLICE_BYTES) {
      unzipper.push(bytes.subarray(at, at + SLICE_BYTES), at + SLICE_BYTES >= bytes.length)
    }
  } catch {
    fail('Not a valid zip archive')
  }
  if (failure) throw failure
  if (entries === 0) throw new PackageError('Not a valid zip archive')

  const root = unwrap(files)
  if (Object.keys(root).some((name) => name !== MANIFEST_NAME && isManifestPath(name))) {
    throw new PackageError('template.json must be at the top level of the template')
  }
  let manifest: TemplateManifest | null = null
  if (MANIFEST_NAME in root) {
    manifest = parseTemplateManifest(root[MANIFEST_NAME])
    delete root[MANIFEST_NAME]
    root['index.md'] = withTemplateName(root['index.md'], manifest)
  }
  if (!('index.md' in root)) throw new PackageError('The template needs an index.md at its top level')

  const names = Object.keys(root)
  for (const name of names) {
    // `a` and `a/b.md` cannot both exist on disk; installing would half-write the package.
    if (names.some((other) => other.startsWith(`${name}/`))) {
      throw new PackageError(`"${name}" is both a file and a folder`)
    }
    if (extensionOf(name) !== 'css') continue
    const remote = findRemoteCssReference(strFromU8(root[name]))
    if (remote) {
      throw new PackageError(`${name} loads or hides remote resources (${remote}); use files inside the template instead`)
    }
  }
  return { files: root, manifest }
}

export function createTemplateZip(files: Record<string, Uint8Array>): Uint8Array {
  return zipSync(files)
}

/** A folder-safe id from a zip file name, made unique against `taken`. */
export function packageIdFromFileName(fileName: string, taken: Set<string>): string {
  let base =
    fileName
      .replace(/\.(?:zip|gmtemplate)$/i, '')
      .replace(/[^A-Za-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'template'
  // A folder named CON or NUL cannot be created on Windows.
  if (RESERVED_NAME.test(base)) base = `template-${base}`
  if (!taken.has(base)) return base
  let n = 1
  while (taken.has(`${base}-${n}`)) n++
  return `${base}-${n}`
}
