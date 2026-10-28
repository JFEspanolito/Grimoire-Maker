/**
 * Detects CSS that makes the browser fetch something, or that hides such a fetch.
 *
 * A pattern match on the raw text is easy to evade (`@import/**\/"..."`, `u\72l(...)`),
 * so the text is first normalised the way a browser tokenises it: a comment is a
 * separator, and escapes (`\72`, `\/`) are decoded. Only then is it inspected.
 * It errs on the side of refusing: this is for CSS from packages the user did not write.
 */

const COMMENT = /\/\*[\s\S]*?(?:\*\/|$)/g
const ESCAPE = /\\([0-9a-fA-F]{1,6})[ \t\n\r\f]?|\\([\s\S])/g

/** Functions that can take an image from a URL or bare string, beyond `url()`. */
const FETCHING_FUNCTION = /(?<!\w)(?:-[a-z]+-)?(?:image-set|cross-fade|image|src|element)\s*\(/i
const URL_FUNCTION = /url\(/gi
const URL_WITH_ARGUMENT = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi

/** Any scheme (`https:`, `ftp:`, `file:`, `C:`) or a `//` or `\\` network path. */
const NON_LOCAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/|\\)/i
/** Inline data the stylesheet carries itself: images and web fonts, never other types (text/html, scripts). */
const INLINE_IMAGE = /^data:(?:image\/|font\/(?:woff2?|ttf|otf|sfnt)[;,]|application\/(?:x-)?font-(?:woff2?|ttf|sfnt)[;,])/i

function decodeEscapes(css: string): string {
  return css.replace(ESCAPE, (_match, hex: string | undefined, char: string | undefined) => {
    if (hex === undefined) return char ?? ''
    const code = parseInt(hex, 16)
    const valid = code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
    return valid ? String.fromCodePoint(code) : '�'
  })
}

/** Returns a short description of the first offending construct, or null if the CSS looks safe. */
export function findRemoteCssReference(css: string): string | null {
  const plain = css.replace(COMMENT, ' ')
  const text = decodeEscapes(plain)

  if (/@import/i.test(text)) return '@import'

  const fetching = FETCHING_FUNCTION.exec(text)
  if (fetching) return `${fetching[0].replace(/\s*\($/, '')}()`

  // An escape at the very start of a url() is how network paths and schemes are disguised.
  if (/url\(\s*['"]?\s*\\/i.test(plain)) return 'escape sequence at the start of url()'

  let seen = 0
  for (const match of text.matchAll(URL_WITH_ARGUMENT)) {
    seen++
    const argument = (match[1] ?? match[2] ?? match[3] ?? '').trim()
    if (NON_LOCAL.test(argument) && !INLINE_IMAGE.test(argument)) return `url(${argument.slice(0, 40)})`
  }
  if ((text.match(URL_FUNCTION) ?? []).length > seen) return 'malformed url()'
  return null
}

/* ---- Theme packs: embedded data: assets <-> files under assets/ ---------------------------- */

/** A theme pack was refused; the message says why and is safe to show the user. */
export class ThemeAssetError extends Error {}

/** The only asset types a theme may embed or ship in a pack, by file extension. */
const ASSET_MIME: Record<string, string> = {
  woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml',
}
/** data: media types (as written in CSS) -> the extension and kind used when they are extracted. */
const EXTRACTABLE: Record<string, { ext: string; kind: 'font' | 'image' }> = {
  'font/woff2': { ext: 'woff2', kind: 'font' }, 'application/font-woff2': { ext: 'woff2', kind: 'font' },
  'font/woff': { ext: 'woff', kind: 'font' }, 'application/font-woff': { ext: 'woff', kind: 'font' }, 'application/x-font-woff': { ext: 'woff', kind: 'font' },
  'font/ttf': { ext: 'ttf', kind: 'font' }, 'application/x-font-ttf': { ext: 'ttf', kind: 'font' }, 'font/sfnt': { ext: 'ttf', kind: 'font' },
  'image/png': { ext: 'png', kind: 'image' }, 'image/jpeg': { ext: 'jpg', kind: 'image' }, 'image/jpg': { ext: 'jpg', kind: 'image' },
  'image/webp': { ext: 'webp', kind: 'image' }, 'image/gif': { ext: 'gif', kind: 'image' }, 'image/svg+xml': { ext: 'svg', kind: 'image' },
}

/** Embedded assets smaller than this stay inline: a separate file would cost more than it saves. */
export const MIN_EXTRACT_BYTES = 2 * 1024
/** A single asset larger than this is refused when a pack is re-inlined. */
export const MAX_PACK_ASSET_BYTES = 8 * 1024 * 1024

export interface ExtractedAsset { name: string; bytes: Uint8Array }

const DATA_URL = /url\(\s*(["']?)data:([a-z0-9.+/-]+);base64,([A-Za-z0-9+/=\s]+)\1\s*\)/gi
const ANY_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s]*))\s*\)/gi

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
  return btoa(binary)
}

function fromBase64(payload: string): Uint8Array | null {
  try {
    const binary = atob(payload)
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

/**
 * Moves every embedded font or image of at least `MIN_EXTRACT_BYTES` out of the stylesheet into
 * `assets/<kind>-<n>.<ext>` and points the CSS at the file. Identical bytes share one file, and
 * names follow first appearance, so the same CSS always yields the same pack.
 */
export function extractDataAssets(css: string): { css: string; assets: ExtractedAsset[] } {
  const assets: ExtractedAsset[] = []
  const byContent = new Map<string, string>()
  const counters = { font: 0, image: 0 }
  const out = css.replace(DATA_URL, (whole, quote: string, mime: string, payload: string) => {
    const type = EXTRACTABLE[mime.toLowerCase()]
    if (!type) return whole
    const clean = payload.replace(/\s+/g, '')
    const key = `${type.ext}|${clean}`
    let name = byContent.get(key)
    if (!name) {
      const bytes = fromBase64(clean)
      if (!bytes || bytes.length < MIN_EXTRACT_BYTES) return whole
      name = `${type.kind}-${++counters[type.kind]}.${type.ext}`
      byContent.set(key, name)
      assets.push({ name, bytes })
    }
    return `url(${quote || '"'}assets/${name}${quote || '"'})`
  })
  return { css: out, assets }
}

const startsWith = (bytes: Uint8Array, ...head: number[]) => head.every((value, i) => bytes[i] === value)

/** The bytes must really be the type their extension claims; a renamed file is refused. */
function looksLike(ext: string, bytes: Uint8Array): boolean {
  switch (ext) {
    case 'png': return startsWith(bytes, 0x89, 0x50, 0x4e, 0x47)
    case 'jpg': case 'jpeg': return startsWith(bytes, 0xff, 0xd8, 0xff)
    case 'gif': return startsWith(bytes, 0x47, 0x49, 0x46, 0x38)
    case 'webp': return startsWith(bytes, 0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
    case 'woff2': return startsWith(bytes, 0x77, 0x4f, 0x46, 0x32)
    case 'woff': return startsWith(bytes, 0x77, 0x4f, 0x46, 0x46)
    case 'ttf': return startsWith(bytes, 0x00, 0x01, 0x00, 0x00) || startsWith(bytes, 0x74, 0x72, 0x75, 0x65)
    case 'otf': return startsWith(bytes, 0x4f, 0x54, 0x54, 0x4f)
    case 'svg': {
      const text = new TextDecoder().decode(bytes.subarray(0, 1 << 20))
      return /<svg[\s>]/i.test(text) && !/<script|<foreignObject|\son[a-z]+\s*=|javascript:/i.test(text)
    }
    default: return false
  }
}

export interface InlineOptions { maxCssBytes: number }

/**
 * Replaces `url(assets/...)` references into a theme pack with `data:` URIs so the installed theme
 * stays one self-contained file. Runs before the remote-reference check; anything that is not a
 * reference into `assets/` is left for that check to judge. A reference to a file the pack does not
 * contain, a file of a disallowed type, or one that is not what its extension claims is refused.
 */
export function inlinePackAssets(css: string, assets: Record<string, Uint8Array>, { maxCssBytes }: InlineOptions): string {
  const encoded = new Map<string, string>()
  const out = css.replace(ANY_URL, (whole, double: string | undefined, single: string | undefined, bare: string | undefined) => {
    const argument = (double ?? single ?? bare ?? '').trim()
    const match = /^(?:\.\/)?(assets\/[^?#]*)(?:[?#].*)?$/.exec(argument)
    if (!match) return whole
    const path = match[1]
    const bytes = assets[path]
    if (!bytes) throw new ThemeAssetError(`The theme refers to "${path}", which is not in the pack`)
    if (encoded.has(path)) return `url("${encoded.get(path)}")`
    const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
    const mime = ASSET_MIME[ext]
    if (!mime) throw new ThemeAssetError(`File type not allowed in a theme pack: "${path}"`)
    if (bytes.length > MAX_PACK_ASSET_BYTES) throw new ThemeAssetError(`"${path}" is too large for a theme (8 MiB limit per file)`)
    if (!looksLike(ext, bytes)) throw new ThemeAssetError(`"${path}" is not a valid ${ext.toUpperCase()} file`)
    const uri = `data:${mime};base64,${toBase64(bytes)}`
    encoded.set(path, uri)
    return `url("${uri}")`
  })
  if (new TextEncoder().encode(out).length > maxCssBytes) throw new ThemeAssetError('The theme is too large once its assets are embedded')
  return out
}

/** Whether a path inside a theme pack is an allowed asset file (by extension only). */
export const isThemeAssetPath = (path: string): boolean => path.slice(path.lastIndexOf('.') + 1).toLowerCase() in ASSET_MIME && path.includes('.')
