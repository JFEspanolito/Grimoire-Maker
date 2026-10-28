import { readDir, readTextFile, stat } from '@tauri-apps/plugin-fs'
import { parseDocument } from './frontmatter'
import {
  applyStyle,
  ensureConfigSubdir,
  hasThemeSelector,
  ID_PATTERN,
  themeName,
  type ThemeInfo,
} from './themes'
import type { Frontmatter } from '../types/document'
import { readTemplateSnippets, type TemplateSnippet } from './templateSnippets'
import { readThemeHeaderFooter } from './themeHeaderFooter'

export interface Template {
  id: string
  label: string
  frontmatter: Frontmatter
  body: string
  builtin: boolean
  snippets?: TemplateSnippet[]
  /** Packages with chapters/assets require a project; a standalone index can fill an untitled editor. */
  requiresProject?: boolean
  /** `project` when the template recreates a whole exported project tree, not only index.md, chapters and assets. */
  layout?: 'project'
  /** Where a community template lives on disk, so it can be exported. */
  location?: { kind: 'package' | 'file'; path: string }
}

const MAX_FILE_BYTES = 512 * 1024

export const OFFICIAL_TEMPLATES: Template[] = [
  {
    id: 'poetry-collection',
    label: 'Poetry Collection',
    frontmatter: { title: 'Untitled Poetry Collection', pageSize: 'b5', columns: 1, theme: 'parchment' },
    body: '# Poetry Collection\n\nBegin your anthology here.\n',
    builtin: true,
  },
  {
    id: 'three-act-novel',
    label: 'Novel - Three Acts',
    frontmatter: { title: 'Untitled Novel', pageSize: 'a4', columns: 1, theme: 'parchment' },
    body: '# Novel - Three Acts\n\nBegin your manuscript here.\n',
    builtin: true,
  },
  {
    id: 'executive-report',
    label: 'Executive Report',
    frontmatter: { title: 'Untitled Executive Report', pageSize: 'a4', columns: 1, theme: 'modern' },
    body: '# Executive Report\n\nSummarize key findings here.\n',
    builtin: true,
  },
  {
    id: 'family-cookbook',
    label: 'Family Cookbook',
    frontmatter: { title: 'Untitled Family Cookbook', pageSize: 'a4', columns: 1, theme: 'parchment' },
    body: '# Family Cookbook\n\nCollect your recipes here.\n',
    builtin: true,
  },
  {
    id: 'independent-zine',
    label: 'Independent Zine',
    frontmatter: { title: 'Untitled Independent Zine', pageSize: 'b5', columns: 1, theme: 'dark-fantasy' },
    body: '# Independent Zine\n\nAssemble your issue here.\n',
    builtin: true,
  },
  {
    id: 'operations-manual',
    label: 'Operations Manual',
    frontmatter: { title: 'Untitled Operations Manual', pageSize: 'a4', columns: 1, theme: 'modern' },
    body: '# Operations Manual\n\nDocument your procedures here.\n',
    builtin: true,
  },
  {
    id: 'rpg-adventure-module',
    label: 'RPG Adventure - Complete Module',
    frontmatter: { title: 'Untitled RPG Adventure Module', pageSize: 'letter', columns: 2, theme: 'parchment' },
    body: '# RPG Adventure - Complete Module\n\nPrepare your adventure here.\n',
    builtin: true,
  },
]

export interface UserTemplates {
  dir: string
  templates: Template[]
  /** Themes shipped inside template packages (`theme.css`), already installed. */
  themes: ThemeInfo[]
  errors: string[]
}

async function readCapped(path: string): Promise<string> {
  if ((await stat(path)).size > MAX_FILE_BYTES) throw new Error(`${path.split('/').pop()} is larger than 512 KB`)
  const text = await readTextFile(path)
  if (text.length > MAX_FILE_BYTES) throw new Error(`${path.split('/').pop()} is larger than 512 KB`)
  return text
}

/**
 * Scans `<appConfigDir>/templates`. A template is either a package folder
 * (`<id>/index.md` plus an optional `<id>/theme.css`) or a single `<id>.md`.
 * A package theme is registered as theme `<id>`, so its CSS must target
 * `[data-theme='<id>']`. Bad entries are reported in `errors`, never fatal.
 */
export interface TemplateScanOptions {
  dir?: string
  allowedFolders?: Set<string>
  reservedIds?: string[]
  styleId?: string
  /** The legacy scan does nothing when its folder is this one (Windows ignores case), so one folder is never read twice. */
  skipWhenSameAs?: string
}

const normalizeFolder = (path: string) => path.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()
const sameFolder = (a: string, b: string) => normalizeFolder(a) === normalizeFolder(b)

export async function loadUserTemplates(takenThemeIds: Set<string>, options: TemplateScanOptions = {}): Promise<UserTemplates> {
  const dir = options.dir ?? await ensureConfigSubdir('templates')
  if (options.skipWhenSameAs && sameFolder(dir, options.skipWhenSameAs)) {
    applyStyle(options.styleId ?? 'grimoire-template-themes', '')
    return { dir, templates: [], themes: [], errors: [] }
  }
  const templates: Template[] = []
  const themes: ThemeInfo[] = []
  const errors: string[] = []
  const css: string[] = []
  const seen = new Set(options.reservedIds ?? OFFICIAL_TEMPLATES.map((t) => t.id))

  const entries = (await readDir(dir)).sort((a, b) => a.name.localeCompare(b.name))
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.isSymlink) continue
    if (options.allowedFolders && (!entry.isDirectory || !options.allowedFolders.has(entry.name))) continue
    const isPackage = entry.isDirectory
    if (!isPackage && !entry.name.toLowerCase().endsWith('.md')) continue
    const id = isPackage ? entry.name : entry.name.replace(/\.md$/i, '')
    if (!ID_PATTERN.test(id)) {
      errors.push(`${entry.name}: name may only use letters, numbers, "-" and "_"`)
      continue
    }
    if (seen.has(id)) {
      errors.push(`${entry.name}: "${id}" is already taken by another template`)
      continue
    }
    try {
      const children = isPackage ? await readDir(`${dir}/${id}`) : []
      if (isPackage && !children.some((file) => file.name === 'index.md' && !file.isDirectory && !file.isSymlink)) {
        throw new Error('A regular index.md file is required')
      }
      const raw = await readCapped(isPackage ? `${dir}/${id}/index.md` : `${dir}/${entry.name}`)
      const { frontmatter, body } = parseDocument(raw)
      const label = String(frontmatter.templateName ?? id)
      delete frontmatter.templateName
      const layout = frontmatter.templateLayout === 'project' ? ('project' as const) : undefined
      delete frontmatter.templateLayout

      const themePath = `${dir}/${id}/theme.css`
      if (isPackage && children.some((file) => file.name === 'theme.css' && !file.isDirectory && !file.isSymlink)) {
        try {
          const themeCss = await readCapped(themePath)
          if (!hasThemeSelector(themeCss, id)) throw new Error(`no [data-theme='${id}'] selector found`)
          if (takenThemeIds.has(id)) throw new Error(`theme "${id}" is already taken`)
          takenThemeIds.add(id)
          const headerFooter = readThemeHeaderFooter(themeCss)
          themes.push({ id, name: themeName(themeCss, label), builtin: false, ...(headerFooter && { headerFooter }) })
          css.push(themeCss)
          frontmatter.theme ??= id
        } catch (e) {
          errors.push(`${id}/theme.css: ${e instanceof Error ? e.message : String(e)}`)
        }
      }

      seen.add(id)
      const packageRoot = `${dir}/${id}`
      const packageSnippets = isPackage
        ? await readTemplateSnippets({ readDir, readTextFile }, packageRoot, id, label)
        : { snippets: [], errors: [] }
      errors.push(...packageSnippets.errors)
      templates.push({
        id,
        label,
        frontmatter,
        ...(layout && { layout }),
        body,
        builtin: false,
        // An exported project (layout `project`) always needs a project; folder names are matched ignoring case.
        requiresProject: isPackage && (layout === 'project' || children.some((file) => ['chapters', 'assets'].includes(file.name.toLowerCase()))),
        snippets: packageSnippets.snippets,
        location: isPackage
          ? { kind: 'package', path: `${dir}/${id}` }
          : { kind: 'file', path: `${dir}/${entry.name}` },
      })
    } catch (e) {
      errors.push(`${entry.name}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  applyStyle(options.styleId ?? 'grimoire-template-themes', css.join('\n'))
  return { dir, templates, themes, errors }
}
