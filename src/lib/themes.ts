import { MAX_THEME_BYTES } from './themeDecorations'
import { appConfigDir, join } from '@tauri-apps/api/path'
import { exists, mkdir, readDir, readTextFile } from '@tauri-apps/plugin-fs'
import { loadLibraryPaths } from './preferences'

export interface ThemeInfo {
  id: string
  name: string
  builtin: boolean
}

export const DEFAULT_THEME = 'parchment'

export const ID_PATTERN = /^[A-Za-z0-9_-]+$/

const BUILTIN_CSS = import.meta.glob('../styles/themes/*.css', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

/** `/* @name: My Theme *\/` anywhere in the file; falls back to the file name. */
function themeNameFromCss(css: string, fallback: string): string {
  return /\/\*\s*@name:\s*(.+?)\s*\*\//.exec(css)?.[1] ?? fallback
}

function fileId(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1).replace(/\.css$/i, '')
}

const builtins = Object.entries(BUILTIN_CSS).map(([path, css]) => {
  const id = fileId(path)
  return { info: { id, name: themeNameFromCss(css, id), builtin: true } satisfies ThemeInfo, css }
})

export const BUILTIN_THEMES: ThemeInfo[] = builtins.map((b) => b.info)

/** Original bytes are retained when the color editor creates a built-in copy. */
export function builtinThemeCss(id: string): string | undefined {
  return builtins.find((theme) => theme.info.id === id)?.css
}

export function applyStyle(styleId: string, css: string): void {
  let el = document.getElementById(styleId)
  if (!el) {
    el = document.createElement('style')
    el.id = styleId
    document.head.append(el)
  }
  el.textContent = css
}

/** Built-ins go through the same path as mods, so the CSS contract is identical. */
export function installBuiltinThemes(): void {
  applyStyle('grimoire-builtin-themes', builtins.map((b) => b.css).join('\n'))
}

/** `<appConfigDir>/<name>` with forward slashes, created on first use. */
export async function ensureConfigSubdir(name: string): Promise<string> {
  const dir = (await join(await appConfigDir(), name)).replaceAll('\\', '/')
  if (!(await exists(dir))) await mkdir(dir, { recursive: true })
  return dir
}

/** The selector every theme file must contain so its rules only apply to that theme. */
export function hasThemeSelector(css: string, id: string): boolean {
  return css.includes(`data-theme='${id}'`) || css.includes(`data-theme="${id}"`)
}

export const themeName = themeNameFromCss

export interface UserThemes {
  dir: string
  themes: ThemeInfo[]
  errors: string[]
}

/**
 * Scans `<appConfigDir>/themes/*.css`, creating the folder on first run, and
 * installs every valid file. A bad file is reported in `errors`, never fatal.
 */
export async function loadUserThemes(): Promise<UserThemes> {
  const dir = (await loadLibraryPaths()).themes
  if (!(await exists(dir))) await mkdir(dir, { recursive: true })

  const themes: ThemeInfo[] = []
  const errors: string[] = []
  const chunks: string[] = []
  const taken = new Set(BUILTIN_THEMES.map((t) => t.id))

  const entries = (await readDir(dir))
    .filter((e) => e.isFile && !e.isSymlink && e.name.toLowerCase().endsWith('.css'))
    .sort((a, b) => a.name.localeCompare(b.name))

  for (const entry of entries) {
    const id = fileId(entry.name)
    if (!ID_PATTERN.test(id)) {
      errors.push(`${entry.name}: file name may only use letters, numbers, "-" and "_"`)
      continue
    }
    if (taken.has(id)) {
      errors.push(`${entry.name}: "${id}" is already taken by another theme`)
      continue
    }
    try {
      const css = await readTextFile(`${dir}/${entry.name}`)
      if (new TextEncoder().encode(css).length > MAX_THEME_BYTES) throw new Error('file is larger than 24 MB')
      if (!hasThemeSelector(css, id)) {
        throw new Error(`no [data-theme='${id}'] selector found`)
      }
      taken.add(id)
      themes.push({ id, name: themeName(css, id), builtin: false })
      chunks.push(css)
    } catch (e) {
      errors.push(`${entry.name}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  applyStyle('grimoire-user-themes', chunks.join('\n'))
  return { dir, themes, errors }
}

/** A document can name a theme that was removed; show the default instead of nothing. */
export function resolveTheme(id: string, themes: ThemeInfo[]): string {
  return themes.some((t) => t.id === id) ? id : DEFAULT_THEME
}
