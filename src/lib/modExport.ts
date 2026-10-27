import { save } from '@tauri-apps/plugin-dialog'
import { readDir, readFile, stat, writeFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { strToU8, zipSync, type Zippable } from 'fflate'
import { useDocumentStore } from '../stores/documentStore'
import { extractDataAssets, findRemoteCssReference } from './cssGuard'
import { buildSnippetFile, maskCode, readSnippetsById, type SnippetInput } from './snippetLibrary'
import {
  APP_VERSION,
  LIMITS,
  cleanLine,
  isPackageFile,
  isSafePackagePath,
  slugify,
  type TemplateManifest,
} from './templatePackage'
import { MAX_THEME_BYTES } from './themeDecorations'
import { readUserThemeSource } from './themeEditor'
import { ID_PATTERN, hasThemeSelector, themeName } from './themes'

/** A file ready to be written where the user chose. */
export interface BuiltFile {
  fileName: string
  bytes: Uint8Array
}

/** Zip entries carry a fixed time so the same input always produces the same archive. */
const ZIP_TIME = new Date(2000, 0, 1)

/* ---- Themes --------------------------------------------------------------------------------- */

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Builds the shareable form of a theme. The CSS starts with a single `@name` comment and uses the
 * `[data-theme='<id>']` selector. Embedded fonts and images of at least 2 KiB are moved into a pack
 * (`<id>.zip` with `theme-pack/theme.css` and `theme-pack/assets/*`); a theme without such assets is
 * a plain `<id>.css`. A theme that loads remote resources is refused: the importer would refuse it.
 */
export function buildThemeExport(css: string, id: string, name: string): BuiltFile & { kind: 'css' | 'zip' } {
  if (!ID_PATTERN.test(id)) throw new Error('Invalid theme ID')
  if (!hasThemeSelector(css, id)) throw new Error(`This theme has no [data-theme='${id}'] selector, so it cannot be shared.`)
  const remote = findRemoteCssReference(css)
  if (remote) throw new Error(`This theme loads a remote resource (${remote}) and cannot be shared. Embed it or remove it first.`)
  const title = cleanLine(name, 80).replace(/\*\//g, '') || id
  const withoutName = css
    .replace(/\/\*\s*@name:[\s\S]*?\*\//g, '')
    .replace(new RegExp(`data-theme=(['"])${escapeRegExp(id)}\\1`, 'g'), `data-theme='${id}'`)
    .replace(/^\s+/, '')
  const { css: shared, assets } = extractDataAssets(withoutName)
  const text = `/* @name: ${title} */\n${shared}${shared.endsWith('\n') ? '' : '\n'}`
  if (assets.length === 0) {
    const bytes = strToU8(text)
    if (bytes.length > MAX_THEME_BYTES) throw new Error('This theme is larger than 24 MB and cannot be shared.')
    return { fileName: `${id}.css`, bytes, kind: 'css' }
  }
  const themeBytes = strToU8(text)
  const entries: Zippable = { 'theme-pack/theme.css': themeBytes }
  let total = themeBytes.length
  for (const asset of assets) {
    entries[`theme-pack/assets/${asset.name}`] = [asset.bytes, { level: 0 }]
    total += asset.bytes.length
  }
  if (total > LIMITS.totalBytes) throw new Error('This theme is too large to share (50 MiB limit once unpacked).')
  return { fileName: `${id}.zip`, bytes: zipSync(entries, { mtime: ZIP_TIME }), kind: 'zip' }
}

/** Saves a user-owned theme as `.css`, or as a `.zip` pack when it embeds assets. Null if the dialog is cancelled. */
export async function exportTheme(id: string): Promise<string | null> {
  const css = await readUserThemeSource(id)
  const built = buildThemeExport(css, id, themeName(css, id))
  const target = await save({
    defaultPath: built.fileName,
    filters: built.kind === 'zip'
      ? [{ name: 'Grimoire theme pack', extensions: ['zip'] }]
      : [{ name: 'Grimoire Theme', extensions: ['css'] }],
  })
  if (!target) return null
  if (built.kind === 'css') await writeTextFile(target, new TextDecoder().decode(built.bytes))
  else await writeFile(target, built.bytes)
  return target
}

/* ---- Snippets ------------------------------------------------------------------------------- */

/**
 * `snippets-pack.zip` with one `<Category>/<name>.md` per snippet. Names are sanitized and made
 * unique ignoring case, so the pack always imports cleanly.
 */
export function buildSnippetPack(list: SnippetInput[]): BuiltFile {
  if (list.length === 0) throw new Error('Choose at least one snippet.')
  if (list.length > LIMITS.entries) throw new Error(`A pack holds ${LIMITS.entries} snippets at most.`)
  const entries: Zippable = {}
  const taken = new Set<string>()
  let total = 0
  for (const input of list) {
    const file = buildSnippetFile(input)
    const stem = file.fileName.replace(/\.md$/i, '')
    let path = `${file.category}/${stem}.md`
    for (let n = 2; taken.has(path.toLowerCase()); n++) path = `${file.category}/${stem}-${n}.md`
    taken.add(path.toLowerCase())
    const bytes = strToU8(file.content)
    total += bytes.length
    entries[path] = bytes
  }
  if (total > LIMITS.totalBytes) throw new Error('These snippets are too large for one pack (50 MiB limit).')
  return { fileName: 'snippets-pack.zip', bytes: zipSync(entries, { mtime: ZIP_TIME }) }
}

/**
 * Saves one snippet as a `.md` file. Pass the snippet's text, or a catalog id (`mod:Snippets/<folder>/<file>`):
 * an id is re-read from the Snippets library, never taken from the UI. Null if the dialog is cancelled.
 */
export async function exportSnippet(input: SnippetInput | string): Promise<string | null> {
  const snippet = typeof input === 'string' ? (await readSnippetsById([input]))[0] : input
  const file = buildSnippetFile(snippet)
  const target = await save({ defaultPath: file.fileName, filters: [{ name: 'Markdown snippet', extensions: ['md'] }] })
  if (!target) return null
  await writeTextFile(target, file.content)
  return target
}

/** Saves the snippets with these catalog ids (re-read from the library) as `snippets-pack.zip`. Null if cancelled. */
export async function exportSnippetPack(ids: string[]): Promise<string | null> {
  return saveSnippetPack(buildSnippetPack(await readSnippetsById(ids)))
}

/** Packs snippet text just written to the library (`<Category>/<name>.md`) and asks where to save the zip. Null if cancelled. */
export async function exportSnippetPackFrom(list: SnippetInput[]): Promise<string | null> {
  return saveSnippetPack(buildSnippetPack(list))
}

async function saveSnippetPack(pack: BuiltFile): Promise<string | null> {
  const target = await save({ defaultPath: pack.fileName, filters: [{ name: 'Snippet pack', extensions: ['zip'] }] })
  if (!target) return null
  await writeFile(target, pack.bytes)
  return target
}

/* ---- Templates ------------------------------------------------------------------------------ */

export interface TemplateMeta {
  name: string
  description?: string
  author?: string
  /** False keeps every path and its frontmatter but empties the body of each file. */
  includeContent: boolean
}

export interface TemplateExport extends BuiltFile {
  manifest: TemplateManifest
  warnings: string[]
}

/** Front matter keys that describe a viewing session rather than the document; never shared. */
export const VOLATILE_FRONTMATTER_KEYS: readonly string[] = [
  'zoom', 'cursor', 'cursorposition', 'scroll', 'scrollposition', 'scrolltop', 'selection',
  'viewmode', 'viewstate', 'undo', 'undohistory', 'history', 'opentabs', 'session', 'lastopened',
]

/** A single optional asset larger than this is skipped with a warning. */
export const MAX_ASSET_BYTES = 8 * 1024 * 1024
const MAX_WARNINGS = 40
const TEXT_EXTENSIONS = new Set(['md', 'txt', 'css'])
const extOf = (path: string): string => path.slice(path.lastIndexOf('.') + 1).toLowerCase()
const dirOf = (path: string): string => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')
const shown = (value: string, max = 90): string => {
  const clean = cleanLine(value, 400)
  return clean.length > max ? `${clean.slice(0, max)}...` : clean
}

const FRONTMATTER_BLOCK = /^\uFEFF?---[^\S\r\n]*\r?\n[\s\S]*?\r?\n---[^\S\r\n]*(?:\r?\n|$)/
const WINDOWS_PATH_ANYWHERE = /(?:^|[\s"'(=,[])[A-Za-z]:[\\/][^\s"']/
const LOCAL_START = /^(?:[A-Za-z]:[\\/]|\\\\|file:|~[\\/]|\/(?![/\s]))/i

/** Whether a frontmatter value is a path on this computer. */
const isLocalPathValue = (value: string): boolean => {
  const v = decodeFully(value.trim().replace(/^(["'])(.*)\1$/, '$2'))
  return LOCAL_START.test(v) || WINDOWS_PATH_ANYWHERE.test(v)
}

interface Context {
  /** Lower-cased package path -> package path, for every file that travels. */
  tree: Map<string, string>
  root: string
  warnings: string[]
  seen: Set<string>
  /** Package path -> the path the file has in the project (links are written against the project layout). */
  origins: Map<string, string>
  /** Lower-cased project path -> package path. */
  projectMap: Map<string, string>
  /** Where a project-relative path lands in the package, or null when the template does not carry that part of the project. */
  layout: (projectPath: string) => string | null
}

function warn(context: Context, message: string): void {
  if (context.seen.has(message)) return
  context.seen.add(message)
  context.warnings.push(message)
}

const safeDecode = (value: string): string => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** Percent-decodes until nothing changes (at most 3 rounds), so `%255C` and `%5C` are both seen as a backslash. */
function decodeFully(value: string): string {
  let current = value
  for (let round = 0; round < 3; round++) {
    const next = safeDecode(current)
    if (next === current) break
    current = next
  }
  return current
}

/** Resolves `.`/`..` against a folder inside the project; null when the path climbs out of it. */
function resolveInProject(folder: string, relative: string): string | null {
  const out = folder ? folder.split('/') : []
  for (const part of relative.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (out.length === 0) return null
      out.pop()
    } else out.push(part)
  }
  return out.join('/')
}

/** `./sub/a.png` or `../Assets/a.png`: `target` as seen from `folder` (both project-relative, `/`-separated). */
function relativeFolderPath(folder: string, target: string): string {
  const from = folder ? folder.split('/') : []
  const to = target.split('/')
  let shared = 0
  while (shared < from.length && shared < to.length - 1 && from[shared].toLowerCase() === to[shared].toLowerCase()) shared++
  const rest = to.slice(shared).join('/')
  return shared === from.length ? `./${rest}` : `${'../'.repeat(from.length - shared)}${rest}`
}

/**
 * Decides what to do with one link target found in `file`:
 *  - `undefined`: leave it (remote, anchor, or a relative path that stays inside the project);
 *  - a string: the new target (an absolute path that lies inside the project, made relative to the file);
 *  - `null`: neutralize it (a path on this computer that the package cannot carry).
 */
function classify(raw: string, file: string, context: Context): string | null | undefined {
  const text = raw.trim().replace(/^<(.*)>$/s, '$1').trim()
  if (!text || text.startsWith('#')) return undefined
  const cut = text.search(/[?#]/)
  const pathPart = cut === -1 ? text : text.slice(0, cut)
  const suffix = cut === -1 ? '' : text.slice(cut)
  // Decode first: `C:%5CUsers%5Cme%5Cx.png` is a path on this computer, not a link with a scheme.
  const decoded = decodeFully(pathPart)
  const isDrive = /^[A-Za-z]:/.test(decoded)
  const scheme = !isDrive ? /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(decoded)?.[1].toLowerCase() : undefined
  let path = decoded.replaceAll('\\', '/')
  if (scheme === 'file') {
    // file:///C:/x or file:///home/x are local; file://server/share is a network location.
    if (!/^file:\/\/\//i.test(path)) {
      warn(context, `Removed a network file link from "${file}" (${shown(text)})`)
      return null
    }
    path = path.slice(7).replace(/^\/([A-Za-z]:\/)/, '$1')
  } else if (scheme) return undefined

  const absolute = /^[A-Za-z]:/.test(path) || path.startsWith('/') || path.startsWith('~/')
  if (!absolute) {
    // Relative links are resolved where the document was in the project and rewritten for where it lands in the package.
    const resolved = resolveInProject(dirOf(context.origins.get(file) ?? file), path)
    if (resolved === null) {
      warn(context, `Removed a link in "${file}" that points outside the project (${shown(text)})`)
      return null
    }
    if (resolved === '') return undefined
    const target = context.layout(resolved)
    if (target === null) {
      warn(context, `Removed a link in "${file}" to a part of the project the template does not include (${shown(text)})`)
      return null
    }
    if (resolveInProject(dirOf(file), path)?.toLowerCase() === target.toLowerCase()) return undefined
    return `${relativeFolderPath(dirOf(file), target)}${suffix}`
  }
  const prefix = `${context.root}/`
  if (path.toLowerCase().startsWith(prefix.toLowerCase())) {
    const mapped = context.projectMap.get(path.slice(prefix.length).toLowerCase())
    const inside = mapped ? context.tree.get(mapped.toLowerCase()) : undefined
    if (inside) return `${relativeFolderPath(dirOf(file), inside)}${suffix}`
    warn(context, `Removed a link in "${file}" to a project file that is not part of the template (${shown(text)})`)
    return null
  }
  warn(context, `Removed a link in "${file}" to a file outside the project (${shown(text)})`)
  return null
}

/** The new text of a Markdown link target: spaces and brackets are escaped, or the target is wrapped in angle brackets. */
function formatMarkdownTarget(original: string, value: string): string {
  const needsAngle = /[\s()<>]/.test(value)
  if (original.trim().startsWith('<')) return `<${value}>`
  return needsAngle ? value.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/</g, '%3C').replace(/>/g, '%3E') : value
}

/** Calls `change` for the destination of every `[text](destination)` / `![alt](destination)` and returns the edited text. */
function mapMarkdownDestinations(text: string, change: (destination: string) => string): string {
  const open = /\]\(/g
  let out = ''
  let last = 0
  for (let match = open.exec(text); match; match = open.exec(text)) {
    let i = match.index + 2
    while (i < text.length && (text[i] === ' ' || text[i] === '\t' || text[i] === '\n')) i++
    const start = i
    let end: number
    if (text[i] === '<') {
      const close = text.indexOf('>', i)
      const newline = text.indexOf('\n', i)
      if (close === -1 || (newline !== -1 && newline < close)) continue
      end = close + 1
    } else {
      let depth = 0
      while (i < text.length) {
        const c = text[i]
        if (c === '\\') { i += 2; continue }
        if (/\s/.test(c)) break
        if (c === '(') depth++
        else if (c === ')') {
          if (depth === 0) break
          depth--
        }
        i++
      }
      end = Math.min(i, text.length)
      // A path on this computer is often pasted with spaces in it: take everything up to the closing parenthesis.
      if (end < text.length && /\s/.test(text[end]) && LOCAL_START.test(text.slice(start, end))) {
        const newline = text.indexOf('\n', start)
        const line = text.slice(start, Math.min(newline === -1 ? text.length : newline, start + 1000))
        let level = 0
        let close = -1
        for (let at = 0; at < line.length && close === -1; at++) {
          if (line[at] === '(') level++
          else if (line[at] === ')') {
            if (level === 0) close = at
            else level--
          }
        }
        if (close !== -1) end = start + line.slice(0, close).replace(/\s+(?:"[^"]*"|'[^']*')\s*$/, '').trimEnd().length
      }
    }
    const destination = text.slice(start, end)
    const replacement = change(destination)
    if (replacement !== destination) {
      out += text.slice(last, start) + replacement
      last = end
    }
    open.lastIndex = Math.max(open.lastIndex, end)
  }
  return out + text.slice(last)
}

const SRCSET = /(\bsrcset\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi
const ATTRIBUTE = /(\b(?:src|href|poster|data-src)\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi
const CSS_URL = /url\(\s*(["']?)([^)"']*)\1\s*\)/gi
const REFERENCE_DEFINITION = /^( {0,3}\[[^\]\n]+\]:[ \t]*)(<[^>\n]*>|[^\n]*?)(?=[ \t]+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\))[ \t]*$|[ \t]*$)/gm
const AUTOLINK = /<((?:file:|[A-Za-z]:(?:[\\/]|%5C|%2F))[^>\s]*)>/gi
const decodeAttribute = (value: string): string => value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
const encodeAttribute = (value: string): string => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')

/** The frontmatter block without session keys and without values that are paths on this computer. */
function cleanFrontmatter(front: string, file: string, context: Context): string {
  if (!front) return ''
  return front.split('\n').filter((line, index) => {
    if (index === 0 || /^---[^\S\r\n]*\r?$/.test(line) || !line.trim()) return true
    const pair = /^([A-Za-z0-9_.-]+)\s*:(.*)$/.exec(line)
    if (pair && VOLATILE_FRONTMATTER_KEYS.includes(pair[1].toLowerCase())) return false
    const value = pair ? pair[2] : /^\s*-\s+(.*)$/.exec(line)?.[1]
    if (value !== undefined && isLocalPathValue(value)) {
      warn(context, `Removed a local path from the front matter of "${file}" (${shown(pair ? `${pair[1]}: ${value.trim()}` : value.trim())})`)
      return false
    }
    return true
  }).join('\n')
}

/** Makes one Markdown file portable. Pure: everything it needs is in `context`. */
function sanitizeMarkdown(source: string, file: string, context: Context): string {
  const front = FRONTMATTER_BLOCK.exec(source)?.[0] ?? ''
  const header = cleanFrontmatter(front, file, context)

  const masked = maskCode(source.slice(front.length))
  let body = mapMarkdownDestinations(masked.text, (destination) => {
    const result = classify(destination, file, context)
    if (result === undefined) return destination
    return result === null ? '' : formatMarkdownTarget(destination, result)
  })
  body = body.replace(REFERENCE_DEFINITION, (whole, head: string, destination: string) => {
    const result = classify(destination, file, context)
    if (result === undefined) return whole
    return `${head}${result === null ? '<>' : formatMarkdownTarget(destination, result)}`
  })
  body = body.replace(ATTRIBUTE, (whole, head: string, double?: string, single?: string, bare?: string) => {
    const value = decodeAttribute(double ?? single ?? bare ?? '')
    const result = classify(value, file, context)
    if (result === undefined) return whole
    return `${head}"${result === null ? '' : encodeAttribute(result)}"`
  })
  body = body.replace(SRCSET, (_whole, head: string, double?: string, single?: string) => {
    const kept: string[] = []
    // Candidates are `url descriptor` pairs separated by a comma and whitespace; a path with spaces stays in one piece.
    for (const candidate of decodeAttribute(double ?? single ?? '').split(/,\s+|,$/)) {
      const part = candidate.trim()
      if (!part) continue
      const descriptor = /\s+[\d.]+[wx]$/.exec(part)?.[0] ?? ''
      const result = classify(part.slice(0, part.length - descriptor.length), file, context)
      if (result === null) continue
      kept.push(result === undefined ? part : `${result}${descriptor}`)
    }
    return `${head}"${encodeAttribute(kept.join(', '))}"`
  })
  body = body.replace(CSS_URL, (whole, _quote: string, value: string) => {
    const result = classify(value, file, context)
    if (result === undefined) return whole
    return result === null ? 'none' : `url("${result.replace(/"/g, '%22')}")`
  })
  body = body.replace(AUTOLINK, (_whole, target: string) => {
    classify(target, file, context)
    return ''
  })
  return header + masked.restore(body)
}

/** Keeps the frontmatter (minus volatile keys) and drops the body. */
function emptyBody(source: string, file: string, context: Context): string {
  return cleanFrontmatter(FRONTMATTER_BLOCK.exec(source)?.[0] ?? '', file, context)
}

const asBytes = (value: string | Uint8Array): Uint8Array => (typeof value === 'string' ? strToU8(value) : value)
const asText = (value: string | Uint8Array): string => (typeof value === 'string' ? value : new TextDecoder().decode(value))

/**
 * Builds the template package from the open project. `files` maps project-relative paths to their
 * content (a key ending in `/` is an empty folder). The result is a zip with `template.json` at its root
 * (`rootDirectory: "Draft"`) and next to it the content of the project's `Draft` folder plus its `Assets`
 * folder, which the importer accepts without any editing. Other project folders (Research, ...) do not
 * travel and links into them are removed. A project without a `Draft` folder is exported whole, with
 * the project folder's name as `rootDirectory`.
 *
 * Left out, silently: hidden files and folders (`.git`, `.cache`, ...), anything whose type a template
 * may not carry. Left out with a warning: names the importer would refuse, case-only duplicates, style
 * sheets that load remote resources, assets that do not fit the limits. Paths on this computer inside
 * documents are made relative when they point into the project, and removed (with a warning) otherwise.
 */
export function buildTemplateExport(
  files: Record<string, string | Uint8Array>,
  projectRoot: string,
  meta: TemplateMeta,
): TemplateExport {
  const name = cleanLine(meta.name, 120)
  if (!name) throw new Error('Give the template a name.')
  const root = projectRoot.replaceAll('\\', '/').replace(/\/+$/, '')
  const warnings: string[] = []
  const normalize = (key: string): string => key.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, '')
  // Spec 4.1: with a Draft folder the template is Draft's content plus the project's Assets folder.
  // A project without Draft is exported whole instead.
  const hasDraft = Object.keys(files).some((key) => normalize(key).split('/')[0].toLowerCase() === 'draft' && (key.endsWith('/') || key.endsWith('\\') || normalize(key).includes('/')))
  const layout = (projectPath: string): string | null => {
    if (!hasDraft) return projectPath
    const [first, ...rest] = projectPath.split('/')
    if (first.toLowerCase() === 'draft') return rest.join('/')
    if (first.toLowerCase() === 'assets') return ['Assets', ...rest].join('/')
    return null
  }
  const context: Context = { tree: new Map(), root, warnings, seen: new Set(), origins: new Map(), projectMap: new Map(), layout }

  // 1. Choose what can travel. Draft content goes first so it wins a name clash with Assets.
  const chosen = new Map<string, string | Uint8Array>()
  const folders = new Set<string>()
  const rank = (key: string): number => (hasDraft && normalize(key).split('/')[0].toLowerCase() === 'assets' ? 1 : 0)
  for (const [rawKey, content] of Object.entries(files).sort(([a], [b]) => rank(a) - rank(b))) {
    const isFolder = rawKey.endsWith('/') || rawKey.endsWith('\\')
    const projectPath = normalize(rawKey)
    if (!projectPath) continue
    const path = layout(projectPath)
    if (!path) continue
    if (isFolder) {
      if (isPackageFile(`${path}/x.md`) && isSafePackagePath(path)) folders.add(path)
      continue
    }
    if (!isPackageFile(path)) continue
    if (!isSafePackagePath(path)) {
      warn(context, `Skipped "${shown(path)}": its name cannot be imported safely`)
      continue
    }
    const lower = path.toLowerCase()
    if (context.tree.has(lower)) {
      warn(context, `Skipped "${shown(path)}": another file differs from it only by letter case`)
      continue
    }
    if (extOf(path) === 'css' && findRemoteCssReference(asText(content))) {
      warn(context, `Skipped "${shown(path)}": it loads remote resources`)
      continue
    }
    context.tree.set(lower, path)
    context.origins.set(path, projectPath)
    context.projectMap.set(projectPath.toLowerCase(), path)
    chosen.set(path, content)
  }

  // 2. Structure only: no images, no file bodies.
  if (!meta.includeContent) {
    for (const path of [...chosen.keys()]) {
      if (!TEXT_EXTENSIONS.has(extOf(path))) {
        chosen.delete(path)
        context.tree.delete(path.toLowerCase())
      }
    }
  }

  // 3. Assets that do not fit are skipped one by one; text that does not fit fails the export.
  const textPaths = [...chosen.keys()].filter((path) => TEXT_EXTENSIONS.has(extOf(path))).sort()
  let total = textPaths.reduce((sum, path) => sum + asBytes(chosen.get(path)!).length, 0)
  let count = textPaths.length + 1
  if (count > LIMITS.entries || total > LIMITS.totalBytes) {
    throw new Error(`This project has too many or too large documents for a template (${LIMITS.entries} files and 50 MiB at most).`)
  }
  for (const path of [...chosen.keys()].filter((p) => !TEXT_EXTENSIONS.has(extOf(p))).sort()) {
    const size = asBytes(chosen.get(path)!).length
    const reason = size > MAX_ASSET_BYTES ? 'it is larger than 8 MiB' : count + 1 > LIMITS.entries ? 'the template would have too many files' : total + size > LIMITS.totalBytes ? 'the template would exceed 50 MiB' : ''
    if (reason) {
      warn(context, `Skipped "${shown(path)}": ${reason}`)
      chosen.delete(path)
      context.tree.delete(path.toLowerCase())
      continue
    }
    total += size
    count++
  }

  // 4. Sanitize documents and assemble.
  const entries: Zippable = {}
  const paths = [...chosen.keys()].sort()
  if (paths.length === 0) throw new Error('This project has no documents to put in a template.')
  let bytesTotal = 0
  for (const path of paths) {
    const content = chosen.get(path)!
    let bytes: Uint8Array
    if (extOf(path) === 'md') {
      const text = asText(content)
      bytes = strToU8(meta.includeContent ? sanitizeMarkdown(text, path, context) : emptyBody(text, path, context))
    } else if (TEXT_EXTENSIONS.has(extOf(path))) {
      bytes = meta.includeContent ? asBytes(content) : new Uint8Array()
    } else bytes = asBytes(content)
    bytesTotal += bytes.length
    entries[path] = TEXT_EXTENSIONS.has(extOf(path)) ? bytes : [bytes, { level: 0 }]
  }

  const directories = new Set<string>()
  for (const path of paths) {
    const parts = path.split('/')
    for (let i = 1; i < parts.length; i++) directories.add(parts.slice(0, i).join('/'))
  }
  let extras = 0
  for (const folder of [...folders].sort()) if (extras < 400 && !directories.has(folder)) { directories.add(folder); extras++ }

  const structure = [
    ...[...directories].map((path) => ({ path: `${path}/`, type: 'directory' as const })),
    ...paths.map((path) => ({ path, type: 'file' as const })),
  ].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))

  const id = slugify(name, 'template')
  const description = meta.description?.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/g, '').trim().slice(0, 2000)
  const author = cleanLine(meta.author ?? '', 120)
  const rootDirectory = hasDraft ? 'Draft' : cleanLine(root.slice(root.lastIndexOf('/') + 1), 100)
  const manifest: TemplateManifest = {
    id,
    name,
    version: '1.0.0',
    grimoireVersion: `>=${/^\d+\.\d+\.\d+/.exec(APP_VERSION)?.[0] ?? '0.0.0'}`,
    ...(author && { author }),
    ...(rootDirectory && { rootDirectory }),
    ...(description && { description }),
    structure,
  }
  const manifestBytes = strToU8(`${JSON.stringify(manifest, null, 2)}\n`)
  if (bytesTotal + manifestBytes.length > LIMITS.totalBytes || paths.length + 1 > LIMITS.entries) {
    throw new Error('The sanitized template is too large to export.')
  }
  entries['template.json'] = manifestBytes
  return { fileName: `${id}.zip`, bytes: zipSync(entries, { mtime: ZIP_TIME }), manifest, warnings: capWarnings(warnings) }
}

function capWarnings(warnings: string[]): string[] {
  return warnings.length <= MAX_WARNINGS ? warnings : [...warnings.slice(0, MAX_WARNINGS), `...and ${warnings.length - MAX_WARNINGS} more`]
}

/** The file system operations reading a project needs; injectable for tests. */
export interface ProjectReader {
  readDir(path: string): Promise<{ name: string; isDirectory: boolean; isSymlink?: boolean }[]>
  readFile(path: string): Promise<Uint8Array>
  stat(path: string): Promise<{ size: number }>
}

const tauriReader: ProjectReader = {
  readDir: async (path) => (await readDir(path)).map((e) => ({ name: e.name, isDirectory: e.isDirectory, isSymlink: e.isSymlink })),
  readFile: (path) => readFile(path),
  stat: async (path) => ({ size: (await stat(path)).size }),
}

const MAX_TREE_DEPTH = 12
const MAX_TREE_ENTRIES = 5000

/**
 * Reads the project folder into `relative path -> content` for `buildTemplateExport`. Hidden entries
 * and links are never followed or read; only file types a template may carry are read at all.
 */
export async function readProjectTree(
  reader: ProjectReader,
  root: string,
): Promise<{ files: Record<string, Uint8Array>; notes: string[] }> {
  const files: Record<string, Uint8Array> = {}
  const notes: string[] = []
  const otherTypes = new Set<string>()
  let visited = 0
  let total = 0

  async function walk(directory: string, prefix: string, depth: number): Promise<void> {
    if (depth > MAX_TREE_DEPTH) {
      notes.push(`"${shown(prefix)}" is nested too deeply and was not included`)
      return
    }
    const entries = await reader.readDir(directory)
    if (entries.length === 0 && prefix) files[prefix] = new Uint8Array()
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      if (entry.name.startsWith('.') || entry.isSymlink) continue
      if (++visited > MAX_TREE_ENTRIES) throw new Error('This project has too many files to export as a template.')
      const relative = `${prefix}${entry.name}`
      if (entry.isDirectory) {
        await walk(`${directory}/${entry.name}`, `${relative}/`, depth + 1)
        continue
      }
      if (!isPackageFile(relative)) {
        otherTypes.add(extOf(relative) || 'no extension')
        continue
      }
      const path = `${directory}/${entry.name}`
      const size = (await reader.stat(path)).size
      if (!TEXT_EXTENSIONS.has(extOf(relative)) && size > MAX_ASSET_BYTES) {
        notes.push(`Skipped "${shown(relative)}": it is larger than 8 MiB`)
        continue
      }
      total += size
      if (total > 2 * LIMITS.totalBytes) throw new Error('This project is too large to export as a template (50 MiB limit).')
      files[relative] = await reader.readFile(path)
    }
  }

  await walk(root.replaceAll('\\', '/').replace(/\/+$/, ''), '', 0)
  if (otherTypes.size > 0) notes.push(`Files of other types were not included (${[...otherTypes].sort().slice(0, 8).join(', ')})`)
  return { files, notes }
}

/**
 * Exports the open project as a template zip: builds it, asks where to save it and writes it there.
 * Returns the chosen path and what was sanitized, or null if the dialog is cancelled. Documents are read
 * from disk, so unsaved edits are not part of the export.
 */
export async function exportProjectAsTemplate(meta: TemplateMeta): Promise<{ path: string; warnings: string[] } | null> {
  const root = useDocumentStore.getState().workspaceRoot
  if (!root) throw new Error('Open a project before exporting it as a template.')
  const { files, notes } = await readProjectTree(tauriReader, root)
  const built = buildTemplateExport(files, root, meta)
  const target = await save({ defaultPath: built.fileName, filters: [{ name: 'Grimoire template', extensions: ['zip'] }] })
  if (!target) return null
  await writeFile(target, built.bytes)
  return { path: target, warnings: [...notes, ...built.warnings] }
}
