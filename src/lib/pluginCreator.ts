import { exists, mkdir, readDir, readTextFile, remove, stat, writeTextFile } from '@tauri-apps/plugin-fs'
import { listExternalPlugins } from './externalPlugins'
import type { ModFs } from './modCatalog'
import { loadLibraryPaths } from './preferences'
import { yamlScalar } from './templatePackage'

/** What the Plugins tab collects: free text only, never a path or code. */
export interface PluginButtonInput {
  label: string
  markdown: string
}
export interface PluginInput {
  name: string
  author?: string
  description?: string
  buttons: PluginButtonInput[]
}

/** Field-level problems in plain English; a missing key means the field is fine. */
export interface PluginInputErrors {
  name?: string
  author?: string
  description?: string
  /** A problem with the list itself (for example "add at least one button"). */
  buttons?: string
  /** One entry per button, in order; an empty object means that button is fine. */
  items: { label?: string; markdown?: string }[]
}

export interface PluginPackage {
  /** Folder name inside the Plugins library. */
  folder: string
  id: string
  files: { 'manifest.json': string; 'dist/index.js': string; 'index.md': string }
}

export const PLUGIN_LIMITS = {
  name: 64,
  author: 64,
  description: 280,
  buttons: 12,
  label: 40,
  markdown: 8192,
  slug: 40,
} as const
export const DEFAULT_PLUGIN_DESCRIPTION = 'Inserts text with buttons.'
export const DEFAULT_PLUGIN_AUTHOR = 'Unknown'
export const PLUGIN_PERMISSION = 'editor:insert'

/* ---- Validation ----------------------------------------------------------------------------- */

/** Control, zero-width and bidirectional characters: never allowed in a single-line field. */
const HIDDEN_OR_CONTROL = /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/
/** The same set minus the three control characters Markdown text may keep. */
const HIDDEN_OR_CONTROL_TEXT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/

/* ---- Inserted text: allow-list (mirror of validate_insert_markdown in src-tauri/src/plugin_package.rs) ---- */

/*
 * The Rust check is authoritative; this copy gives instant feedback and must give the same verdict
 * (src/lib/fixtures/insert-corpus.json is run by both). Rules, judged on the raw text and on every further
 * decoding of it (character references with any number of digits, percent escapes, backslash escapes):
 *  - no raw HTML: a `<` followed (after white space) by a letter, `/`, `!` or `?`;
 *  - every Markdown link, image and `[label]: target` is an anchor or a relative path: no scheme of any kind,
 *    no leading `/`, no `//host`, no drive letter, no `:` before the first `/`, `?` or `#`;
 *  - no bare http: https: ftp: ftps: file: ws: wss: data: blob: javascript: vbscript: asset: tauri: ipc: scheme,
 *    `www.host.tld` or `//host.tld` anywhere, even in plain prose.
 * False positives on purpose: "data: 5", "File: notes", `Vec<String>` and `<name>` are refused.
 */

const MAX_DECODE_ROUNDS = 10
const URL_SCHEMES = ['http', 'https', 'ftp', 'ftps', 'file', 'ws', 'wss', 'data', 'blob', 'javascript', 'vbscript', 'asset', 'tauri', 'ipc']
const NAMED_ENTITIES: [string, string][] = [
  ['colon', ':'], ['sol', '/'], ['bsol', '\\'], ['amp', '&'], ['lt', '<'], ['gt', '>'], ['quot', '"'], ['apos', "'"],
  ['tab', '\t'], ['newline', '\n'], ['lpar', '('], ['rpar', ')'], ['equals', '='], ['percnt', '%'], ['num', '#'],
  ['excl', '!'], ['comma', ','], ['period', '.'], ['lsqb', '['], ['rsqb', ']'], ['nbsp', ' '],
]

/** White space as Unicode defines it (the same set as the Rust check). */
function isSpace(c: string): boolean {
  const n = c.codePointAt(0)!
  return (n >= 9 && n <= 13) || n === 32 || n === 0xa0 || n === 0x1680 || (n >= 0x2000 && n <= 0x200a)
    || n === 0x2028 || n === 0x2029 || n === 0x202f || n === 0x205f || n === 0x3000
}
function isInvisibleCode(n: number): boolean {
  return n === 0xad || n === 0x61c || n === 0x180e || (n >= 0x200b && n <= 0x200f) || (n >= 0x2028 && n <= 0x202e)
    || (n >= 0x2060 && n <= 0x206f) || n === 0xfeff || (n >= 0xfff9 && n <= 0xfffb)
}
/** Control, zero-width and direction characters: a browser drops or ignores them inside an address. */
function isHidden(c: string): boolean {
  const n = c.codePointAt(0)!
  return n <= 0x1f || (n >= 0x7f && n <= 0x9f) || isInvisibleCode(n)
}
const isAsciiAlpha = (c: string | undefined): boolean => {
  if (c === undefined || c.length !== 1) return false
  const n = c.charCodeAt(0)
  return (n >= 65 && n <= 90) || (n >= 97 && n <= 122)
}
const isAsciiAlnum = (c: string | undefined): boolean => {
  if (c === undefined || c.length !== 1) return false
  const n = c.charCodeAt(0)
  return (n >= 48 && n <= 57) || isAsciiAlpha(c)
}
const isAsciiPunct = (c: string): boolean => {
  if (c.length !== 1) return false
  const n = c.charCodeAt(0)
  return (n >= 33 && n <= 47) || (n >= 58 && n <= 64) || (n >= 91 && n <= 96) || (n >= 123 && n <= 126)
}
/** Full-width ASCII becomes ASCII and ASCII letters become lower case; nothing else changes. */
function fold(c: string): string {
  let n = c.codePointAt(0)!
  if (n >= 0xff01 && n <= 0xff5e) n -= 0xfee0
  if (n >= 65 && n <= 90) n += 32
  return String.fromCodePoint(n)
}
const skippable = (c: string): boolean => isSpace(c) || isHidden(c) || c === '\\'
const sameChars = (a: string[], b: string[]): boolean => a.length === b.length && a.every((c, i) => c === b[i])

function digitValue(c: string | undefined, radix: number): number {
  if (c === undefined || c.length !== 1) return -1
  const n = c.charCodeAt(0)
  let value = -1
  if (n >= 48 && n <= 57) value = n - 48
  else if (n >= 97 && n <= 102) value = n - 87
  else if (n >= 65 && n <= 70) value = n - 55
  return value >= 0 && value < radix ? value : -1
}

/** One character reference at `at` (a `&`): the character and the chars consumed. Numeric references take any number of digits and an optional `;`; named ones match by longest known prefix. */
function entityAt(chars: string[], at: number): [string, number] | null {
  if (chars[at + 1] === '#') {
    const hex = chars[at + 2] === 'x' || chars[at + 2] === 'X'
    const radix = hex ? 16 : 10
    const start = at + (hex ? 3 : 2)
    let end = start
    let value = 0
    while (end < chars.length) {
      const digit = digitValue(chars[end], radix)
      if (digit < 0) break
      value = Math.min(value * radix + digit, 0x110000)
      end++
    }
    if (end === start) return null
    if (value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) return null
    return [String.fromCodePoint(value), (chars[end] === ';' ? end + 1 : end) - at]
  }
  let run = ''
  for (let k = at + 1; k < chars.length && run.length < 16 && isAsciiAlnum(chars[k]); k++) run += fold(chars[k])
  let best: [string, string] | null = null
  for (const entry of NAMED_ENTITIES) {
    if (run.startsWith(entry[0]) && (best === null || entry[0].length > best[0].length)) best = entry
  }
  if (best === null) return null
  const end = at + 1 + best[0].length
  return [best[1], (run.length === best[0].length && chars[end] === ';' ? end + 1 : end) - at]
}

function entityDecode(chars: string[]): string[] {
  const out: string[] = []
  let i = 0
  while (i < chars.length) {
    if (chars[i] === '&') {
      const found = entityAt(chars, i)
      if (found) {
        out.push(found[0])
        i += found[1]
        continue
      }
    }
    out.push(chars[i])
    i++
  }
  return out
}

/** `%XX` escapes of ASCII characters; anything else stays as written. */
function percentDecode(chars: string[]): string[] {
  const out: string[] = []
  let i = 0
  while (i < chars.length) {
    if (chars[i] === '%' && i + 2 < chars.length) {
      const hi = digitValue(chars[i + 1], 16)
      const lo = digitValue(chars[i + 2], 16)
      if (hi >= 0 && lo >= 0 && hi * 16 + lo < 0x80) {
        out.push(String.fromCharCode(hi * 16 + lo))
        i += 3
        continue
      }
    }
    out.push(chars[i])
    i++
  }
  return out
}

/** A backslash before ASCII punctuation is an escape in Markdown: drop the backslash. */
function unescapeChars(chars: string[]): string[] {
  const out: string[] = []
  let i = 0
  while (i < chars.length) {
    if (chars[i] === '\\' && i + 1 < chars.length && isAsciiPunct(chars[i + 1])) {
      out.push(chars[i + 1])
      i += 2
    } else {
      out.push(chars[i])
      i++
    }
  }
  return out
}

/** Every stage of decoding `start` until nothing changes, or null when it still changes after MAX_DECODE_ROUNDS rounds. */
function decodeChain(start: string[], escapes: boolean): string[][] | null {
  const stages = [start]
  for (let round = 0; round <= MAX_DECODE_ROUNDS; round++) {
    const last = stages[stages.length - 1]
    const next = percentDecode(entityDecode(escapes ? unescapeChars(last) : last))
    if (sameChars(next, last)) return stages
    stages.push(next)
  }
  return null
}

/** A `<` followed (after optional white space) by a letter, `/`, `!` or `?` starts a tag, comment, declaration or autolink. */
function hasHtml(view: string[]): boolean {
  for (let i = 0; i < view.length; i++) {
    if (view[i] !== '<') continue
    let j = i + 1
    while (j < view.length && isSpace(view[j])) j++
    const next = view[j]
    if (next !== undefined && (isAsciiAlpha(next) || next === '/' || next === '!' || next === '?')) return true
  }
  return false
}

/** Matches `word` at `from` letting ignorable characters sit between its letters; the index after it, or -1. */
function matchWord(folded: string[], from: number, word: string): number {
  let j = from
  const letters = Array.from(word)
  for (let k = 0; k < letters.length; k++) {
    if (k > 0) while (j < folded.length && skippable(folded[j])) j++
    if (folded[j] !== letters[k]) return -1
    j++
  }
  return j
}

/** A run of host characters that contains a dot followed by a letter or digit, e.g. `x.com`. */
function looksLikeHost(chars: string[], from: number): boolean {
  let k = from
  while (k < chars.length && (isAsciiAlnum(chars[k]) || chars[k] === '.' || chars[k] === '-')) {
    if (chars[k] === '.' && isAsciiAlnum(chars[k + 1])) return true
    k++
  }
  return false
}

const ADDRESS_PROBLEM = 'Web, file, script and app addresses (http:, https:, ftp:, file:, data:, blob:, javascript:, asset:, tauri: ...) and www. addresses are not allowed, even in plain text.'
const HOST_PROBLEM = 'Addresses that start with // are not allowed, even in plain text.'
const HTML_PROBLEM = 'Raw HTML is not allowed: a < followed by a letter, /, ! or ? starts a tag, comment or link. Put a space and a number after a < instead.'
const TARGET_PROBLEM = 'Links and images can only point to a relative file (./notes.md) or an anchor (#top); a target that starts with /, or has a : before its first /, is not allowed.'
const DEEP_PROBLEM = 'This text is encoded too many times to be checked and is not allowed.'

/** A listed scheme followed by `:`, a `www.` host or a `//host.tld` target anywhere in the text. */
function bareAddress(view: string[]): string {
  const folded = view.map(fold)
  for (let i = 0; i < folded.length; i++) {
    if (i > 0 && isAsciiAlnum(folded[i - 1])) continue
    for (const scheme of URL_SCHEMES) {
      if (folded[i] !== scheme[0]) continue
      let j = matchWord(folded, i, scheme)
      if (j < 0) continue
      while (j < folded.length && skippable(folded[j])) j++
      if (folded[j] === ':') return ADDRESS_PROBLEM
    }
    if (folded[i] === 'w') {
      const j = matchWord(folded, i, 'www.')
      if (j >= 0 && looksLikeHost(folded, j)) return ADDRESS_PROBLEM
    }
    const slash = (k: number) => folded[k] === '/' || folded[k] === '\\'
    if (slash(i) && slash(i + 1) && looksLikeHost(folded, i + 2)) return HOST_PROBLEM
  }
  return ''
}

/** The destination that starts at `start` (just after `](` or `]:`) and where it ended: `<...>` or a token that stops at white space or at the unbalanced `)` that closes the link. */
function parseDestination(view: string[], start: number): [string[], number] {
  const n = view.length
  let j = start
  while (j < n && isSpace(view[j])) j++
  const dest: string[] = []
  if (j < n && view[j] === '<') {
    j++
    while (j < n && view[j] !== '>') dest.push(view[j++])
    return [dest, j]
  }
  let depth = 0
  while (j < n && !isSpace(view[j])) {
    if (view[j] === '(') depth++
    else if (view[j] === ')') {
      if (depth === 0) break
      depth--
    }
    dest.push(view[j++])
  }
  return [dest, j]
}

/** Every inline `](dest)` (links and images) and every `[label]: dest` definition at the start of a line. */
function destinations(view: string[]): string[][] {
  const n = view.length
  const found: string[][] = []
  let i = 0
  while (i < n) {
    if (i === 0 || view[i - 1] === '\n' || view[i - 1] === '\r') {
      let j = i
      while (j < n && (view[j] === ' ' || view[j] === '\t')) j++
      if (j < n && view[j] === '[') {
        let k = j + 1
        while (k + 1 < n && view[k] !== '\n' && view[k] !== '\r' && !(view[k] === ']' && view[k + 1] === ':')) k++
        if (k + 1 < n && view[k] === ']' && view[k + 1] === ':') found.push(parseDestination(view, k + 2)[0])
      }
    }
    if (view[i] === ']' && view[i + 1] === '(') {
      const [dest, end] = parseDestination(view, i + 2)
      found.push(dest)
      i = Math.max(end, i + 1)
      continue
    }
    i++
  }
  return found
}

/** One decoded stage of a destination is safe only when it is empty, an anchor or a relative path. */
function stageIsUnsafe(stage: string[]): boolean {
  const cleaned = stage.filter((c) => !isSpace(c) && !isHidden(c)).map(fold).map((c) => (c === '\\' ? '/' : c))
  let start = cleaned.findIndex((c) => c !== '"' && c !== "'" && c !== '<')
  if (start < 0) start = cleaned.length
  let last = -1
  for (let k = cleaned.length - 1; k >= 0; k--) {
    if (cleaned[k] !== '"' && cleaned[k] !== "'" && cleaned[k] !== '>') { last = k; break }
  }
  const end = Math.max(last < 0 ? start : last + 1, start)
  const trimmed = cleaned.slice(start, end)
  if (trimmed[0] === '/') return true
  return trimmed.find((c) => c === ':' || c === '/' || c === '?' || c === '#') === ':'
}

function destinationIsUnsafe(raw: string[]): boolean {
  const trim = (c: string) => isSpace(c) || c === '"' || c === "'"
  let from = raw.findIndex((c) => !trim(c))
  if (from < 0) from = raw.length
  let to = from
  for (let k = raw.length - 1; k >= 0; k--) {
    if (!trim(raw[k])) { to = k + 1; break }
  }
  const stages = decodeChain(raw.slice(from, Math.max(to, from)), true)
  return stages === null || stages.some(stageIsUnsafe)
}

/** The first construct of one decoded view that Markdown insertion must not carry, or ''. */
function viewProblem(view: string[]): string {
  if (hasHtml(view)) return HTML_PROBLEM
  const address = bareAddress(view)
  if (address) return address
  if (destinations(view).some(destinationIsUnsafe)) return TARGET_PROBLEM
  return ''
}

/** A plain-English reason when the text carries remote, active or non-relative content, or '' when it is fine. */
export function activeContentProblem(markdown: string): string {
  const views = decodeChain(Array.from(markdown), false)
  if (views === null) return DEEP_PROBLEM
  for (const view of views) {
    const problem = viewProblem(view)
    if (problem) return problem
  }
  return ''
}

function lineProblem(label: string, value: string, max: number, required: boolean): string {
  const text = value.trim()
  if (required && !text) return `Enter ${label}.`
  if (HIDDEN_OR_CONTROL.test(value)) return `${capitalize(label)} cannot contain control or invisible characters.`
  if ([...text].length > max) return `${capitalize(label)} must be ${max} characters or fewer.`
  return ''
}
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/** Validates the creator's form with the same rules as the application's manifest check. */
export function validatePluginInput(input: PluginInput): PluginInputErrors {
  const errors: PluginInputErrors = { items: [] }
  const name = lineProblem('a plugin name', input.name, PLUGIN_LIMITS.name, true)
  if (name) errors.name = name
  const author = lineProblem('the author', input.author ?? '', PLUGIN_LIMITS.author, false)
  if (author) errors.author = author
  const description = lineProblem('the description', input.description ?? '', PLUGIN_LIMITS.description, false)
  if (description) errors.description = description

  if (input.buttons.length < 1) errors.buttons = 'Add at least one button.'
  else if (input.buttons.length > PLUGIN_LIMITS.buttons) errors.buttons = `A plugin can have at most ${PLUGIN_LIMITS.buttons} buttons.`
  errors.items = input.buttons.map((button) => {
    const item: { label?: string; markdown?: string } = {}
    const label = lineProblem('a button label', button.label, PLUGIN_LIMITS.label, true)
    if (label) item.label = label
    const markdown = markdownProblem(button.markdown)
    if (markdown) item.markdown = markdown
    return item
  })
  return errors
}

function markdownProblem(markdown: string): string {
  if (!markdown.trim()) return 'Enter the text this button inserts.'
  if (Array.from(markdown).length > PLUGIN_LIMITS.markdown) return `The text must be ${PLUGIN_LIMITS.markdown} characters or fewer.`
  if (HIDDEN_OR_CONTROL_TEXT.test(markdown)) return 'The text cannot contain control or invisible characters (line breaks and tabs are fine).'
  return activeContentProblem(markdown)
}

/** True when any field has a problem. */
export function hasPluginErrors(errors: PluginInputErrors): boolean {
  return Boolean(errors.name || errors.author || errors.description || errors.buttons || errors.items.some((item) => item.label || item.markdown))
}

/** The first problem in reading order, for places that show one sentence. */
export function firstPluginError(errors: PluginInputErrors): string {
  return errors.name ?? errors.author ?? errors.description ?? errors.buttons
    ?? errors.items.map((item) => item.label ?? item.markdown).find(Boolean) ?? ''
}

/* ---- Package -------------------------------------------------------------------------------- */

const WINDOWS_DEVICE = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/

/** `Encounter Tools` -> `encounter-tools`: lowercase ASCII letters, digits and single hyphens, at most 40 characters. */
export function slugify(name: string): string {
  let slug = name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, PLUGIN_LIMITS.slug).replace(/-+$/, '')
  if (!slug) return 'plugin'
  // A folder named like a Windows device (con, nul, com1...) cannot be created there.
  if (WINDOWS_DEVICE.test(slug)) slug = `${slug}-plugin`
  return slug
}

/** `base`, then `base-2`, `base-3`... until the candidate is not in `taken` (compared ignoring case). */
function uniqueName(base: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((item) => item.toLowerCase()))
  if (!used.has(base.toLowerCase())) return base
  for (let suffix = 2; ; suffix++) {
    const candidate = `${base}-${suffix}`
    if (!used.has(candidate.toLowerCase())) return candidate
  }
}

const ENTRY_FILE = '// This plugin has no code. The application draws its buttons from manifest.json.\n'

function tutorial(input: PluginInput, id: string, description: string): string {
  return `---
pluginName: ${yamlScalar(input.name.trim())}
pluginId: ${id}
pluginDescription: ${yamlScalar(description)}
---
# ${input.name.trim().replace(/[\r\n]+/g, ' ')}: a plugin made with Create Plugin

This folder is a complete plugin package. It was created by **Create Mod > Plugins**.

## What is in the folder

- \`manifest.json\` describes the plugin and holds the text of each button. The application reads it and draws the buttons for you.
- \`dist/index.js\` is the plugin's code. It is a single comment on purpose: no code runs for this plugin.
- \`index.md\` is this page. It is only documentation and is ignored.

## Edit the buttons

1. Open \`manifest.json\` in a text editor.
2. Under \`contributions.toolbar\`, each button has a \`label\` and an \`action.markdown\`. Change the text, or copy a whole button and give it a new \`id\`.
3. Keep \`"permissions": ["editor:insert"]\`. A plugin can have up to 16 buttons, and each text can be up to 8192 characters.
4. Open **Mod Manager** and choose **Refresh**. A running plugin whose files changed is restarted.

Line breaks inside the text are written as \`\\n\` in \`manifest.json\`.

## Remove it

Delete this folder (or use **Remove** on its card in Mod Manager > Plugins), then choose **Refresh**.

## What it can and cannot do

The plugin can only insert the text you wrote when you press one of its buttons. It cannot read your pages, files or network.

For safety, the text may only use plain Markdown. It cannot contain HTML (a < followed by a letter, /, ! or ?), addresses such as http:, https:, ftp:, file:, data:, blob:, javascript:, asset: or www.example.com, or links and images that point anywhere but a relative file (./notes.md, ../map.png) or an anchor (#top). Words like data: or file: are refused even in plain text.
`
}

/** Builds the three files of a plugin from the creator's form. Pure: nothing is written. */
export function buildPluginPackage(
  input: PluginInput,
  options: { existingIds?: string[]; existingFolders?: string[] } = {},
): PluginPackage {
  const errors = validatePluginInput(input)
  if (hasPluginErrors(errors)) throw new Error(firstPluginError(errors))
  const slug = slugify(input.name)
  const id = uniqueName(`custom.${slug}`, options.existingIds ?? [])
  const folder = uniqueName(slug, options.existingFolders ?? [])
  const description = input.description?.trim() || DEFAULT_PLUGIN_DESCRIPTION
  const manifest = {
    schemaVersion: 1,
    sdkVersion: 2,
    id,
    name: input.name.trim(),
    version: '1.0.0',
    author: input.author?.trim() || DEFAULT_PLUGIN_AUTHOR,
    description,
    main: 'dist/index.js',
    permissions: [PLUGIN_PERMISSION],
    contributions: {
      toolbar: input.buttons.map((button, index) => ({
        id: `insert-${index + 1}`,
        type: 'button',
        label: button.label.trim(),
        action: { type: 'insertMarkdown', markdown: button.markdown },
      })),
    },
  }
  return {
    folder,
    id,
    files: {
      'manifest.json': `${JSON.stringify(manifest, null, 2)}\n`,
      'dist/index.js': ENTRY_FILE,
      'index.md': tutorial(input, id, description),
    },
  }
}

/* ---- Writing -------------------------------------------------------------------------------- */

/** The file system the creator needs: the mod file system plus a recursive remove for its own cleanup. */
export interface PluginFs extends ModFs {
  remove(path: string): Promise<void>
  /** Creates ONE folder and fails when it already exists (never recursive, never a no-op on an existing folder). */
  createDir(path: string): Promise<void>
}

const tauriPluginFs: PluginFs = {
  exists: (path) => exists(path),
  readDir: async (path) => (await readDir(path)).map((e) => ({ name: e.name, isDirectory: e.isDirectory, isSymlink: e.isSymlink })),
  readTextFile: (path) => readTextFile(path),
  stat: async (path) => ({ size: (await stat(path)).size }),
  mkdir: (path) => mkdir(path, { recursive: true }),
  // Exclusive creation: an existing file is never replaced, even if it appears after the check.
  writeTextFile: (path, text) => writeTextFile(path, text, { createNew: true }),
  createDir: (path) => mkdir(path, { recursive: false }),
  remove: (path) => remove(path, { recursive: true }),
}

const MAX_PACKAGES_SCANNED = 500

async function packageIds(io: PluginFs, root: string, folders: { name: string; isDirectory: boolean; isSymlink?: boolean }[]): Promise<string[]> {
  const ids: string[] = []
  for (const entry of folders.filter((item) => item.isDirectory && !item.isSymlink).slice(0, MAX_PACKAGES_SCANNED)) {
    try {
      const manifest = JSON.parse(await io.readTextFile(`${root}/${entry.name}/manifest.json`)) as { id?: unknown }
      if (typeof manifest.id === 'string') ids.push(manifest.id)
    } catch { /* a folder without a readable manifest has no id to protect */ }
  }
  return ids
}

/**
 * Writes `{Plugins library}/{slug}/` and returns where it went. Never replaces anything: a taken folder name
 * gets `-2`, `-3`... and the id is made unique against every package folder and the managed registry.
 * `dist/index.js` and `index.md` are written first and `manifest.json` last, so a folder only counts as a plugin
 * once it is complete; if a write fails, the folder this call created is removed (and nothing else: the folder is
 * made with a non-recursive create, so only a folder this call really created is ever removed).
 */
export async function createPluginFromInput(input: PluginInput, io: PluginFs = tauriPluginFs, pluginsRoot?: string): Promise<{ folder: string; id: string; path: string }> {
  const errors = validatePluginInput(input)
  if (hasPluginErrors(errors)) throw new Error(firstPluginError(errors))
  const root = pluginsRoot ?? (await loadLibraryPaths()).plugins
  if (!(await io.exists(root))) await io.mkdir(root)
  const entries = await io.readDir(root)
  const registryIds = await listExternalPlugins().then((registry) => Object.keys(registry.plugins)).catch(() => [] as string[])
  const existingIds = [...registryIds, ...(await packageIds(io, root, entries))]
  const taken = entries.map((entry) => entry.name)

  for (let attempt = 0; attempt < 100; attempt++) {
    const pack = buildPluginPackage(input, { existingIds, existingFolders: taken })
    const path = `${root}/${pack.folder}`
    // Lost a race (or a hidden name): skip it and look for the next free one.
    if (await io.exists(path)) { taken.push(pack.folder); continue }
    // Non-recursive: a folder that already exists (even if `exists` missed it) fails here, before cleanup is armed.
    try {
      await io.createDir(path)
    } catch (error) {
      if (await io.exists(path).catch(() => false)) { taken.push(pack.folder); continue }
      throw error
    }
    try {
      await io.mkdir(`${path}/dist`)
      await io.writeTextFile(`${path}/dist/index.js`, pack.files['dist/index.js'])
      await io.writeTextFile(`${path}/index.md`, pack.files['index.md'])
      await io.writeTextFile(`${path}/manifest.json`, pack.files['manifest.json'])
    } catch (error) {
      await io.remove(path).catch(() => undefined)
      throw error
    }
    return { folder: pack.folder, id: pack.id, path }
  }
  throw new Error('Could not find a free folder name for the plugin.')
}
