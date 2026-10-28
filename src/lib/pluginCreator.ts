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

const NAMED_ENTITIES: Record<string, string> = {
  colon: ':', sol: '/', bsol: '\\', lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", equals: '=',
  lpar: '(', rpar: ')', tab: '\t', newline: '\n', nbsp: ' ',
}

/** Decodes numeric and the few named HTML entities that matter for the content check (semicolon optional). */
function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]{1,6});?/gi, (whole, hex: string) => codePoint(parseInt(hex, 16), whole))
    .replace(/&#(\d{1,7});?/g, (whole, dec: string) => codePoint(parseInt(dec, 10), whole))
    .replace(/&([a-z]+);?/gi, (whole, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? whole)
}
function codePoint(value: number, fallback: string): string {
  try { return String.fromCodePoint(value) } catch { return fallback }
}
/** Decodes %XX escapes of ASCII characters; anything else stays as written. */
function decodePercent(text: string): string {
  return text.replace(/%([0-9a-f]{2})/gi, (whole, hex: string) => {
    const value = parseInt(hex, 16)
    return value < 0x80 ? String.fromCharCode(value) : whole
  })
}

/** The raw text plus every further entity/percent decoding of it, and a copy without whitespace (`java\tscript:`). */
function checkVariants(text: string): string[] {
  const seen = new Set<string>()
  const queue = [text]
  for (let round = 0; round < 4; round++) {
    const next: string[] = []
    for (const item of queue) {
      if (seen.has(item)) continue
      seen.add(item)
      next.push(decodeEntities(item), decodePercent(item), decodePercent(decodeEntities(item)))
    }
    queue.splice(0, queue.length, ...next)
  }
  for (const item of [...seen]) seen.add(item.replace(/[\s\u0000-\u001f]+/g, ''))
  return [...seen]
}

const SCHEME = /(?<![a-z0-9+.-])(?:https?|ftp|data|file|javascript|vbscript):/i
const PROTOCOL_RELATIVE = [
  /\]\(\s*<?\s*[/\\]{2}/,
  /\]:\s*<?\s*[/\\]{2}/,
  /=\s*["']?\s*[/\\]{2}/,
  /<\s*[/\\]{2}/,
]
const ACTIVE_TAG = /<\s*(?:script|iframe|object|embed|link|meta|style|base|form)(?![a-z0-9])/i
const EVENT_HANDLER = /(?<![a-z0-9_])on[a-z]{3,}\s*=/i

/** A plain-English reason when the text carries remote or active content, or '' when it is fine. */
export function activeContentProblem(markdown: string): string {
  for (const variant of checkVariants(markdown)) {
    if (SCHEME.test(variant)) return 'Links and images that point to the internet, to files or to scripts (http:, https:, ftp:, data:, file:, javascript:) are not allowed. Relative links and anchors are fine.'
    if (PROTOCOL_RELATIVE.some((pattern) => pattern.test(variant))) return 'Links that start with // point to the internet and are not allowed. Relative links and anchors are fine.'
    if (ACTIVE_TAG.test(variant)) return 'HTML tags that run code or load other content (script, iframe, object, embed, link, meta, style, base, form) are not allowed.'
    if (EVENT_HANDLER.test(variant)) return 'HTML event attributes such as onclick= are not allowed.'
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
  if (markdown.length > PLUGIN_LIMITS.markdown) return `The text must be ${PLUGIN_LIMITS.markdown} characters or fewer.`
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

For safety, the text cannot contain links to the internet, to files or to scripts (http, https, ftp, data, file, javascript), links that start with //, or HTML that runs code (script, iframe, object, embed, link, meta, style, base, form, and attributes such as onclick). Relative links and anchors are fine.
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
}

const tauriPluginFs: PluginFs = {
  exists: (path) => exists(path),
  readDir: async (path) => (await readDir(path)).map((e) => ({ name: e.name, isDirectory: e.isDirectory, isSymlink: e.isSymlink })),
  readTextFile: (path) => readTextFile(path),
  stat: async (path) => ({ size: (await stat(path)).size }),
  mkdir: (path) => mkdir(path, { recursive: true }),
  // Exclusive creation: an existing file is never replaced, even if it appears after the check.
  writeTextFile: (path, text) => writeTextFile(path, text, { createNew: true }),
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
 * once it is complete; if a write fails, the folder this call created is removed (and nothing else).
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
    await io.mkdir(path)
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
