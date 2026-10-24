import { readDir, readTextFile, rename, writeTextFile } from '@tauri-apps/plugin-fs'
import { loadLibraryPaths } from './preferences'
import { builtinThemeCss, hasThemeSelector, ID_PATTERN, type ThemeInfo } from './themes'

export const COLOR_FIELDS = {
  background: 'Background', text: 'Text', h1: 'H1', h2: 'H2', h3: 'H3', divider: 'Divider',
  accent: 'Accent', statblock: 'Stat block', readaloud: 'Read aloud',
} as const
export type ThemeColors = Record<keyof typeof COLOR_FIELDS, string>
export interface ThemeDraft { theme: ThemeInfo; css: string; path: string | null; directory: string }
const COLOR = /^#[\da-f]{6}$/i
const MAX_BYTES = 256 * 1024
const OVERRIDES = /\n?\/\* grimoire-colors:start \*\/[\s\S]*?\/\* grimoire-colors:end \*\//g

/** Pickers accept only opaque hex colors; other CSS remains intact in the source. */
export function themeColors(css: string): ThemeColors {
  const value = (name: string, fallback: string) => {
    const matches = [...css.matchAll(new RegExp(`--${name}\\s*:\\s*(#[\\da-f]{6})\\s*[;}]`, 'gi'))]
    return matches.at(-1)?.[1] ?? fallback
  }
  const heading = value('heading-color', '#58180d')
  const accent = value('accent', '#9c2b1a')
  return {
    background: value('page-bg', '#f4e8c8'), text: value('page-fg', '#2b2118'),
    h1: value('h1-color', heading), h2: value('h2-color', heading), h3: value('h3-color', heading),
    divider: value('divider-color', accent), accent,
    statblock: value('statblock-bg', '#fdf1dc'), readaloud: value('readaloud-bg', '#e9dcb8'),
  }
}

function validateName(name: string): string {
  const clean = name.trim()
  if (!clean || clean.length > 80 || !/^[\p{L}\p{N} _().-]+$/u.test(clean)) {
    throw new Error('Use 1–80 letters, numbers, spaces, parentheses, dots, underscores or hyphens for the name.')
  }
  return clean
}

export function buildThemeCss(source: string, sourceId: string, id: string, name: string, colors: ThemeColors): string {
  if (!ID_PATTERN.test(id) || !ID_PATTERN.test(sourceId)) throw new Error('Invalid theme ID')
  const title = validateName(name)
  for (const key of Object.keys(COLOR_FIELDS) as (keyof ThemeColors)[]) {
    if (!COLOR.test(colors[key])) throw new Error(`${COLOR_FIELDS[key]} must be a six-digit hex color.`)
  }
  const selector = `[data-theme='${id}']`
  const css = source.replace(OVERRIDES, '')
    .replace(new RegExp(`data-theme=(['"])${sourceId}\\1`, 'g'), `data-theme='${id}'`)
    .replace(/\/\*\s*@name:[\s\S]*?\*\//g, '')
  return `/* @name: ${title} */\n${css}\n/* grimoire-colors:start */
${selector} {
  --page-bg: ${colors.background}; --page-fg: ${colors.text};
  --h1-color: ${colors.h1}; --h2-color: ${colors.h2}; --h3-color: ${colors.h3};
  --divider-color: ${colors.divider}; --accent: ${colors.accent};
  --statblock-bg: ${colors.statblock}; --readaloud-bg: ${colors.readaloud};
}
${[1, 2, 3].map((level) => `${selector} .grimoire-content h${level} { color: ${colors[`h${level}` as keyof ThemeColors]}; }`).join('\n')}
${selector} .grimoire-content hr { border-color: ${colors.divider}; }
/* grimoire-colors:end */\n`
}

async function regularFile(directory: string, name: string): Promise<void> {
  const entry = (await readDir(directory)).find((file) => file.name === name)
  if (!entry?.isFile || entry.isSymlink) throw new Error('The theme must be a regular, non-linked file. Reload and try again.')
}

export async function loadThemeDraft(theme: ThemeInfo, userOwned: boolean): Promise<ThemeDraft> {
  if (!ID_PATTERN.test(theme.id)) throw new Error('Invalid theme ID')
  const paths = await loadLibraryPaths()
  let css = builtinThemeCss(theme.id)
  let path: string | null = null
  if (!css) {
    if (userOwned) {
      const entry = (await readDir(paths.themes)).find((file) => file.name.replace(/\.css$/i, '') === theme.id)
      if (!entry) throw new Error('The theme file was removed. Reload themes and try again.')
      await regularFile(paths.themes, entry.name)
      path = `${paths.themes}/${entry.name}`
      css = await readTextFile(path)
    } else {
      css = await readTextFile(`${paths.templates}/${theme.id}/theme.css`)
    }
  }
  if (new TextEncoder().encode(css).length > MAX_BYTES || !hasThemeSelector(css, theme.id)) throw new Error('The theme source is invalid or larger than 256 KB.')
  return { theme, css, path, directory: paths.themes }
}

export async function saveThemeDraft(draft: ThemeDraft, name: string, colors: ThemeColors, copy: boolean, takenIds: string[]): Promise<ThemeInfo> {
  const title = validateName(name)
  const directory = (await loadLibraryPaths()).themes
  if (directory !== draft.directory) throw new Error('Themes Path changed. Reopen Customize Theme before saving.')
  const creating = copy || !draft.path
  let id = draft.theme.id
  if (creating) {
    const base = title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'custom-theme'
    const files = await readDir(directory)
    const taken = new Set([...takenIds, ...files.map((file) => file.name.replace(/\.css$/i, ''))].map((item) => item.toLowerCase()))
    id = base
    for (let suffix = 2; taken.has(id.toLowerCase()) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(id); suffix++) id = `${base}-${suffix}`
  }
  const css = buildThemeCss(draft.css, draft.theme.id, id, title, colors)
  if (new TextEncoder().encode(css).length > MAX_BYTES) throw new Error('The saved theme would exceed 256 KB.')
  if (creating) {
    await writeTextFile(`${directory}/${id}.css`, css, { createNew: true })
  } else {
    const path = draft.path!
    const unchanged = async () => {
      await regularFile(directory, path.slice(path.lastIndexOf('/') + 1))
      if (await readTextFile(path) !== draft.css) throw new Error('The theme changed outside this editor. Reopen it before saving.')
    }
    await unchanged()
    const temporary = `${directory}/.${id}-${crypto.randomUUID()}.tmp`
    await writeTextFile(temporary, css, { createNew: true })
    try {
      await unchanged()
      await rename(temporary, path)
    } catch (cause) {
      throw new Error(`Could not publish the theme; the temporary copy remains at ${temporary}. ${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }
  return { id, name: title, builtin: false }
}
