import { exists, mkdir, readDir, readTextFile, stat, writeTextFile } from '@tauri-apps/plugin-fs'
import { parseDocument } from './frontmatter'
import { ensureModDirectory, type ModFs } from './modCatalog'
import { loadLibraryPaths } from './preferences'
import { cleanLine, isSafePackagePath, sanitizePathSegment, yamlScalar } from './templatePackage'

/** What a snippet is made from: free text, never a path. */
export interface SnippetInput {
  name: string
  category: string
  author?: string
  markdown: string
}

/** A snippet ready to write: `fileName` and `category` are already safe single path segments. */
export interface SnippetFile {
  fileName: string
  category: string
  content: string
}

/** Mod Manager refuses Markdown files over this size, so nothing larger is ever written. */
export const MAX_SNIPPET_BYTES = 512 * 1024
export const DEFAULT_CATEGORY = 'General'
const DEFAULT_NAME = 'snippet'

/** The real file system, reached lazily so importing this module costs nothing. */
const tauriModFs: ModFs = {
  exists: (path) => exists(path),
  readDir: async (path) => (await readDir(path)).map((e) => ({ name: e.name, isDirectory: e.isDirectory, isSymlink: e.isSymlink })),
  readTextFile: (path) => readTextFile(path),
  stat: async (path) => ({ size: (await stat(path)).size }),
  mkdir: (path) => mkdir(path, { recursive: true }),
  // Exclusive creation: an existing file is never replaced, even if it appears after the check.
  writeTextFile: (path, text) => writeTextFile(path, text, { createNew: true }),
}

/* ---- Code masking (shared with the template exporter) -------------------------------------- */

const OPEN = ''
const CLOSE = ''

/**
 * Hides fenced code blocks and inline code behind placeholders so Markdown/HTML processing never
 * touches code. `restore` puts the original text back.
 */
export function maskCode(source: string): { text: string; restore: (masked: string) => string } {
  const saved: string[] = []
  const keep = (code: string): string => `${OPEN}${saved.push(code) - 1}${CLOSE}`
  const lines = source.replaceAll(OPEN, '').replaceAll(CLOSE, '').split('\n')
  const out: string[] = []
  let fence: { char: string; length: number } | null = null
  let block: string[] = []
  for (const line of lines) {
    if (fence) {
      block.push(line)
      const close = new RegExp(`^ {0,3}${fence.char === '`' ? '`' : '~'}{${fence.length},}[ \\t]*$`)
      if (close.test(line)) {
        out.push(keep(block.join('\n')))
        fence = null
        block = []
      }
      continue
    }
    const open = /^ {0,3}(`{3,}|~{3,})/.exec(line)
    if (open) {
      fence = { char: open[1][0], length: open[1].length }
      block = [line]
      continue
    }
    out.push(line)
  }
  // An unclosed fence runs to the end of the text, exactly as Markdown reads it.
  if (fence) out.push(keep(block.join('\n')))
  const text = out.join('\n').replace(/(`+)(?!`)([\s\S]{0,1000}?[^`])\1(?!`)/g, (whole) => (whole.includes('\n\n') ? whole : keep(whole)))
  const placeholder = new RegExp(`${OPEN}(\\d+)${CLOSE}`, 'g')
  return {
    text,
    restore: (masked) => {
      let result = masked
      // Fenced blocks can contain no placeholders, but inline code inside a restored block never occurs either.
      result = result.replace(placeholder, (_whole, index: string) => saved[Number(index)] ?? '')
      return result
    },
  }
}

/* ---- Normalization -------------------------------------------------------------------------- */

const FRONTMATTER = /^﻿?---[^\S\r\n]*\n[\s\S]*?\n(?:---|\.\.\.)[^\S\r\n]*(?:\n|$)/
const DIV_TAG = /<(\/?)div\b[^>]*>/gi
const SECTION_BREAK = /<div\b[^>]*\bdata-type\s*=\s*["']section-break["'][^>]*>\s*<\/div>/gi
const BOX_OPEN = /\bdata-type\s*=\s*["']standard-content-box["']/i
const IMG_TAG = /<img\b[^>]*>/gi
/** Image attributes that pin an image to the page: text wrap, size in mm, page anchor and position. */
const IMAGE_LAYOUT_ATTRIBUTES = /\s+(?:data-align|data-width-mm|data-anchor|data-x-mm|data-y-mm|style)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi

/**
 * Makes Markdown behave as an independent single-column block. Exactly this is removed:
 *   - a leading YAML frontmatter block (page-level `columns`, `pageSize`, `theme`, ...);
 *   - section/column break markers (`<div data-type="section-break" data-columns="2"></div>`);
 *   - the wrapper of a content box (`<div data-type="standard-content-box" data-width-mm=... style=...>`),
 *     whose fixed width, height, border, free position and page placement tie it to the page; its content stays;
 *   - on `<img>` tags, the page-layout attributes data-align, data-width-mm, data-anchor, data-x-mm,
 *     data-y-mm and style (frame and opacity are kept: they style the image, not the page);
 *   - blank-line runs longer than one, and leading/trailing blank lines.
 * Everything else is kept verbatim: headings, lists, tables, links, read-aloud/statblock/character-sheet
 * blocks and code. Running it again changes nothing.
 */
export function normalizeSnippetMarkdown(markdown: string): string {
  const masked = maskCode(markdown.replace(/\r\n?/g, '\n').replace(FRONTMATTER, ''))
  let text = masked.text.replace(SECTION_BREAK, '')

  // Content boxes can nest other divs, so match their closing tag by depth rather than by pattern.
  const stack: boolean[] = []
  text = text.replace(DIV_TAG, (tag, closing: string) => {
    if (closing) return stack.pop() ? '\n' : tag
    const isBox = BOX_OPEN.test(tag)
    stack.push(isBox)
    return isBox ? '\n' : tag
  })

  text = text.replace(IMG_TAG, (tag) => tag.replace(IMAGE_LAYOUT_ATTRIBUTES, ''))
  text = text.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '')
  const restored = masked.restore(text)
  return restored ? `${restored}\n` : ''
}

/* ---- Files ---------------------------------------------------------------------------------- */

/** `Encounter Table (d6)` -> `Encounter-Table-d6`: a safe file name stem. */
export const snippetFileStem = (name: string): string => sanitizePathSegment(name, DEFAULT_NAME, { max: 80 })
/** `Dungeons & Dragons` -> `Dungeons Dragons`: a safe category folder name (spaces allowed, it is a group label). */
export const snippetCategory = (category: string): string => sanitizePathSegment(category, DEFAULT_CATEGORY, { max: 60, spaces: true })

/**
 * Builds the snippet file. Name, author and category are single-line, sanitized text, so none of
 * them can add a frontmatter key, a `---` line or a line break; the body is the normalized Markdown.
 */
export function buildSnippetFile(input: SnippetInput): SnippetFile {
  const category = snippetCategory(input.category)
  const name = cleanLine(input.name, 120) || DEFAULT_NAME
  const author = cleanLine(input.author ?? '', 80)
  const body = normalizeSnippetMarkdown(input.markdown)
  if (!body) throw new Error('The snippet has no content to save.')
  const content = [
    '---',
    `snippetName: ${yamlScalar(name)}`,
    ...(author ? [`author: ${yamlScalar(author)}`] : []),
    `tags: [${yamlScalar(category)}]`,
    '---',
    body,
  ].join('\n')
  if (new TextEncoder().encode(content).length > MAX_SNIPPET_BYTES) throw new Error('The snippet is larger than 512 KiB.')
  return { fileName: `${snippetFileStem(name)}.md`, category, content }
}

/** The first tag of a snippet's frontmatter (`tags: [A, B]`, `tags: A` or quoted forms), or null. */
export function firstSnippetTag(frontmatter: Record<string, unknown>): string | null {
  const raw = frontmatter.tags
  if (typeof raw !== 'string') return null
  const inner = raw.trim().replace(/^\[/, '').replace(/\]$/, '')
  const first = /^\s*(?:"([^"]*)"|'([^']*)'|([^,]*))/.exec(inner)
  const tag = cleanLine(first?.[1] ?? first?.[2] ?? first?.[3] ?? '', 200)
  return tag || null
}

/**
 * Writes `{Snippets library}/{Category}/{Normalized-Name}.md` and returns its path. The category folder
 * is reused when it exists (ignoring case, like Mod Manager's group ids); an existing file is never
 * replaced: `-2`, `-3`, ... is added to the name instead.
 */
export async function saveSnippetToLibrary(input: SnippetInput, io: ModFs = tauriModFs, snippetsRoot?: string): Promise<{ path: string }> {
  const file = buildSnippetFile(input)
  const root = snippetsRoot ?? (await loadLibraryPaths()).snippets
  if (!(await io.exists(root))) await io.mkdir(root)
  const directory = await ensureModDirectory(io, root, file.category)
  const stem = file.fileName.replace(/\.md$/i, '')
  const taken = new Set((await io.readDir(directory)).map((entry) => entry.name.toLowerCase()))
  for (let suffix = 1; suffix < 1000; suffix++) {
    const name = `${suffix === 1 ? stem : `${stem}-${suffix}`}.md`
    if (taken.has(name.toLowerCase())) continue
    const path = `${directory}/${name}`
    try {
      await io.writeTextFile(path, file.content)
      return { path }
    } catch (error) {
      // Lost a race for the name: try the next one. Anything else is a real failure.
      if (!(await io.exists(path))) throw error
    }
  }
  throw new Error('Could not find a free file name for the snippet.')
}

const SNIPPET_ID = /^mod:Snippets\/([^/]+)\/(.+)$/

/**
 * Re-reads catalog snippets (`mod:Snippets/<folder>/<relative path>`) from the library so an export
 * never trusts text held by the UI. The id only selects entries: every segment must exist as a real
 * (non-link) file or folder in the library, so an id can never address anything outside it.
 */
export async function readSnippetsById(ids: string[], io: ModFs = tauriModFs, snippetsRoot?: string): Promise<SnippetInput[]> {
  if (ids.length === 0) throw new Error('Choose at least one snippet.')
  if (ids.length > 512) throw new Error('Too many snippets selected (512 at most).')
  const root = snippetsRoot ?? (await loadLibraryPaths()).snippets
  const out: SnippetInput[] = []
  for (const id of new Set(ids)) {
    const match = SNIPPET_ID.exec(id)
    if (!match || !isSafePackagePath(match[2])) throw new Error('That snippet could not be found. Refresh Mod Manager and try again.')
    const group = (await io.readDir(root)).find((e) => e.isDirectory && !e.isSymlink && e.name.toLowerCase() === match[1].toLowerCase())
    if (!group) throw new Error('That snippet could not be found. Refresh Mod Manager and try again.')
    let directory = `${root}/${group.name}`
    const segments = match[2].split('/')
    for (const [index, segment] of segments.entries()) {
      const last = index === segments.length - 1
      const entry = (await io.readDir(directory)).find((e) => e.name === segment && !e.isSymlink && e.isDirectory === !last)
      if (!entry) throw new Error('That snippet could not be found. Refresh Mod Manager and try again.')
      directory = `${directory}/${segment}`
    }
    if (!/\.md$/i.test(directory) || (await io.stat(directory)).size > MAX_SNIPPET_BYTES) throw new Error('That snippet could not be read.')
    const { frontmatter, body } = parseDocument(await io.readTextFile(directory))
    const stem = segments[segments.length - 1].replace(/\.md$/i, '')
    out.push({
      name: String(frontmatter.snippetName ?? stem),
      category: group.name,
      author: typeof frontmatter.author === 'string' ? frontmatter.author : undefined,
      markdown: body,
    })
  }
  return out
}
