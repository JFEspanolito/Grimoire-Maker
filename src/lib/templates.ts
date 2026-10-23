import { exists, readDir, readTextFile } from '@tauri-apps/plugin-fs'
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

export interface Template {
  id: string
  label: string
  frontmatter: Frontmatter
  body: string
  builtin: boolean
  snippets?: TemplateSnippet[]
  /** Where a community template lives on disk, so it can be exported. */
  location?: { kind: 'package' | 'file'; path: string }
}

const MAX_FILE_BYTES = 512 * 1024

export const OFFICIAL_TEMPLATES: Template[] = [
  {
    id: 'classic-fantasy',
    label: 'Classic Fantasy',
    frontmatter: { title: 'Untitled Adventure', pageSize: 'a4', columns: 2, theme: 'parchment' },
    body: '# Chapter One\n\nBegin here.\n',
    builtin: true,
  },
  {
    id: 'quick-one-shot',
    label: 'Quick One-Shot (5 pages)',
    frontmatter: { title: 'Untitled One-Shot', pageSize: 'letter', columns: 2, theme: 'modern' },
    body: '# The Hook\n\n# The Location\n\n# The Encounter\n\n# The Reward\n',
    builtin: true,
  },
  {
    id: 'a5-zine',
    label: 'A5 Folded Zine',
    frontmatter: { title: 'Untitled Zine', pageSize: 'b5', columns: 1, theme: 'dark-fantasy' },
    body: '# Zine Title\n',
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
export async function loadUserTemplates(takenThemeIds: Set<string>): Promise<UserTemplates> {
  const dir = await ensureConfigSubdir('templates')
  const templates: Template[] = []
  const themes: ThemeInfo[] = []
  const errors: string[] = []
  const css: string[] = []
  const seen = new Set(OFFICIAL_TEMPLATES.map((t) => t.id))

  const entries = (await readDir(dir)).sort((a, b) => a.name.localeCompare(b.name))
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
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
      const raw = await readCapped(isPackage ? `${dir}/${id}/index.md` : `${dir}/${entry.name}`)
      const { frontmatter, body } = parseDocument(raw)
      const label = String(frontmatter.templateName ?? id)
      delete frontmatter.templateName

      const themePath = `${dir}/${id}/theme.css`
      if (isPackage && (await exists(themePath))) {
        try {
          const themeCss = await readCapped(themePath)
          if (!hasThemeSelector(themeCss, id)) throw new Error(`no [data-theme='${id}'] selector found`)
          if (takenThemeIds.has(id)) throw new Error(`theme "${id}" is already taken`)
          takenThemeIds.add(id)
          themes.push({ id, name: themeName(themeCss, label), builtin: false })
          css.push(themeCss)
          frontmatter.theme ??= id
        } catch (e) {
          errors.push(`${id}/theme.css: ${e instanceof Error ? e.message : String(e)}`)
        }
      }

      seen.add(id)
      const packageRoot = `${dir}/${id}`
      const packageSnippets = isPackage
        ? await readTemplateSnippets({ exists, readDir, readTextFile }, packageRoot, id, label)
        : { snippets: [], errors: [] }
      errors.push(...packageSnippets.errors)
      templates.push({
        id,
        label,
        frontmatter,
        body,
        builtin: false,
        snippets: packageSnippets.snippets,
        location: isPackage
          ? { kind: 'package', path: `${dir}/${id}` }
          : { kind: 'file', path: `${dir}/${entry.name}` },
      })
    } catch (e) {
      errors.push(`${entry.name}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  applyStyle('grimoire-template-themes', css.join('\n'))
  return { dir, templates, themes, errors }
}
