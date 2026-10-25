import { parseDocument } from './frontmatter'
import type { TemplateSnippet } from './templateSnippets'

export const MOD_KIND = {
  SNIPPETS: 'Snippets',
  TEMPLATES: 'Templates',
  THEMES: 'Themes',
  PLUGINS: 'Plugins',
} as const
export type ModKind = (typeof MOD_KIND)[keyof typeof MOD_KIND]
export interface ModEntry {
  id: string
  kind: ModKind
  label: string
  folder: string
  enabled: boolean
  errors: string[]
}
export interface ModFileEntry { name: string; isDirectory: boolean; isSymlink?: boolean }
export interface ModFs {
  exists(path: string): Promise<boolean>
  mkdir(path: string): Promise<void>
  readDir(path: string): Promise<ModFileEntry[]>
  readTextFile(path: string): Promise<string>
  writeTextFile(path: string, text: string): Promise<void>
  stat(path: string): Promise<{ size: number }>
}
export interface ModCatalog { mods: ModEntry[]; snippets: TemplateSnippet[]; errors: string[] }
const MAX_BYTES = 512 * 1024
const message = (error: unknown) => error instanceof Error ? error.message : String(error)
export const modKey = (kind: ModKind, name: string) => `${kind}/${name.toLowerCase()}`

/** Do not follow a linked category or package during discovery or seeding. */
export async function ensureModDirectory(io: ModFs, parent: string, name: string): Promise<string> {
  const entry = (await io.readDir(parent)).find((file) => file.name.toLowerCase() === name.toLowerCase())
  if (entry && (!entry.isDirectory || entry.isSymlink)) throw new Error(`${name}: expected a real directory, not a link or file`)
  const path = `${parent}/${entry?.name ?? name}`
  if (!entry) await io.mkdir(path)
  return path
}

export async function seedExamples(io: ModFs, root: string, examples: Record<string, string>): Promise<void> {
  if (await io.exists(`${root}/.examples-seeded`)) return
  for (const [relative, contents] of Object.entries(examples)) {
    const segments = relative.split('/')
    let parent = root
    for (const name of segments.slice(0, -1)) parent = await ensureModDirectory(io, parent, name)
    const path = `${parent}/${segments.at(-1)}`
    // The adapter also uses exclusive creation against races; never replace an edited example.
    if (!(await io.exists(path))) await io.writeTextFile(path, contents)
  }
  await io.writeTextFile(`${root}/.examples-seeded`, '1\n')
}

export async function discoverMods(io: ModFs, root: string, disabled: string[], paths?: Partial<Record<ModKind, string>>): Promise<ModCatalog> {
  const mods: ModEntry[] = []
  const snippets: TemplateSnippet[] = []
  const errors: string[] = []
  let bytes = 0
  const read = async (path: string) => {
    const { size } = await io.stat(path)
    if (size > MAX_BYTES) throw new Error('Markdown file exceeds 512 KiB')
    bytes += size
    if (bytes > 16 * 1024 * 1024) throw new Error('Mod catalog exceeds 16 MiB')
    const raw = await io.readTextFile(path)
    if (raw.length > MAX_BYTES) throw new Error('Markdown file exceeds 512 KiB')
    return raw
  }
  for (const kind of [MOD_KIND.SNIPPETS, MOD_KIND.TEMPLATES] as const) {
    const category = paths?.[kind] ?? await ensureModDirectory(io, root, kind)
    const entries = (await io.readDir(category)).filter((entry) => !entry.name.startsWith('.') && entry.isDirectory && !entry.isSymlink)
      .sort((a, b) => a.name.localeCompare(b.name))
    if (entries.length > 256) throw new Error(`${kind}: limit of 256 mod folders exceeded`)
    const seen = new Set<string>()
    for (const entry of entries) {
      const id = modKey(kind, entry.name)
      if (seen.has(id)) { errors.push(`${id}: duplicate folder name ignoring case`); continue }
      seen.add(id)
      const folder = `${category}/${entry.name}`
      const mod: ModEntry = { id, kind, label: entry.name, folder, enabled: !disabled.includes(id), errors: [] }
      mods.push(mod)
      try {
        if (kind === MOD_KIND.TEMPLATES) {
          if (!/^[A-Za-z0-9_-]+$/.test(entry.name)) throw new Error('Template folder names use letters, numbers, hyphens or underscores')
          const index = (await io.readDir(folder)).find((file) => file.name === 'index.md')
          if (!index || index.isDirectory || index.isSymlink) throw new Error('A regular index.md file is required')
          const { frontmatter } = parseDocument(await read(`${folder}/index.md`))
          mod.label = String(frontmatter.templateName ?? entry.name)
        } else {
          let count = 0
          const walk = async (dir: string, relative: string, depth: number): Promise<void> => {
            if (depth > 4) throw new Error('Snippet folders exceed four nested levels')
            for (const file of (await io.readDir(dir)).sort((a, b) => a.name.localeCompare(b.name))) {
              if (file.name.startsWith('.') || file.isSymlink) continue
              if (++count > 512) throw new Error('Snippet group exceeds 512 entries')
              const name = `${relative}${file.name}`
              if (file.isDirectory) { await walk(`${dir}/${file.name}`, `${name}/`, depth + 1); continue }
              if (!/\.md$/i.test(file.name)) continue
              try {
                const { frontmatter, body } = parseDocument(await read(`${dir}/${file.name}`))
                if (!body.trim()) throw new Error('Empty snippet')
                if (mod.enabled) snippets.push({ id: `mod:${id}/${name}`, group: entry.name,
                  label: String(frontmatter.snippetName ?? file.name.replace(/\.md$/i, '')), markdown: body })
              } catch (error) { mod.errors.push(`${name}: ${message(error)}`) }
            }
          }
          await walk(folder, '', 0)
        }
      } catch (error) { mod.errors.push(message(error)) }
      errors.push(...mod.errors.map((error) => `${id}: ${error}`))
    }
  }
  if (paths?.Themes && await io.exists(paths.Themes)) {
    const themeEntries = (await io.readDir(paths.Themes))
      .filter((entry) => !entry.name.startsWith('.') && !entry.isDirectory && !entry.isSymlink && /\.css$/i.test(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name))
    const seen = new Set<string>()
    for (const entry of themeEntries) {
      const stem = entry.name.replace(/\.css$/i, '')
      const id = modKey(MOD_KIND.THEMES, stem)
      if (seen.has(id)) continue
      seen.add(id)
      const filePath = `${paths.Themes}/${entry.name}`
      let label = stem
      const modErrors: string[] = []
      try {
        const css = await io.readTextFile(filePath)
        const match = /\/\*\s*@name:\s*(.+?)\s*\*\//.exec(css)
        if (match?.[1]) label = match[1]
      } catch (error) {
        modErrors.push(message(error))
      }
      mods.push({ id, kind: MOD_KIND.THEMES, label, folder: filePath, enabled: !disabled.includes(id), errors: modErrors })
    }
  }
  if (paths?.Plugins && await io.exists(paths.Plugins)) {
    const pluginEntries = (await io.readDir(paths.Plugins))
      .filter((entry) => !entry.name.startsWith('.') && entry.isDirectory && !entry.isSymlink)
      .sort((a, b) => a.name.localeCompare(b.name))
    if (pluginEntries.length > 256) throw new Error('Plugins: limit of 256 mod folders exceeded')
    const seen = new Set<string>()
    for (const entry of pluginEntries) {
      const id = modKey(MOD_KIND.PLUGINS, entry.name)
      if (seen.has(id)) continue
      const folder = `${paths.Plugins}/${entry.name}`
      seen.add(id)
      const mod: ModEntry = { id, kind: MOD_KIND.PLUGINS, label: entry.name, folder, enabled: !disabled.includes(id), errors: [] }
      try {
        const files = await io.readDir(folder)
        if (!files.some(file => !file.isDirectory && !file.isSymlink && /\.(tsx?|js)$/i.test(file.name) && !file.name.endsWith('.d.ts'))) {
          if (!files.some(file => file.name === 'index.md')) continue
          mod.errors.push('This folder has documentation only; add a TSX, TS or JS plugin entry.')
        }
      } catch (error) { mod.errors.push(message(error)) }
      mods.push(mod)
      errors.push(...mod.errors.map(error => `${id}: ${error}`))
    }
  }
  return { mods, snippets, errors }
}
