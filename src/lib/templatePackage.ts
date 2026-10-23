import { Unzip, UnzipInflate, UnzipPassThrough, strFromU8, zipSync } from 'fflate'
import { findRemoteCssReference } from './cssGuard'

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
const INVISIBLE_CHARS = /[​-‏‪-‮⁦-⁩]/
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
export function readTemplateZip(
  bytes: Uint8Array,
  { limits = LIMITS, stats }: ReadOptions = {},
): Record<string, Uint8Array> {
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
      if (!ALLOWED_EXTENSIONS.has(extensionOf(file.name))) {
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
  return root
}

export function createTemplateZip(files: Record<string, Uint8Array>): Uint8Array {
  return zipSync(files)
}

/** A folder-safe id from a zip file name, made unique against `taken`. */
export function packageIdFromFileName(fileName: string, taken: Set<string>): string {
  let base =
    fileName
      .replace(/\.zip$/i, '')
      .replace(/[^A-Za-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'template'
  // A folder named CON or NUL cannot be created on Windows.
  if (RESERVED_NAME.test(base)) base = `template-${base}`
  if (!taken.has(base)) return base
  let n = 1
  while (taken.has(`${base}-${n}`)) n++
  return `${base}-${n}`
}
