import { configRoot } from './configRoot'
import { exists, mkdir, readDir, readTextFile, rename, stat, writeTextFile } from '@tauri-apps/plugin-fs'
import { ensureModDirectory, seedExamples, type ModFs } from './modCatalog'
import { loadLibraryPaths, type LibraryPaths } from './preferences'
import { installOfficialPlugin, listOfficialPlugins } from './officialPlugins'
import type { MigrationFs } from './migratedPlugins'

const exampleFiles = import.meta.glob(['../assets/mods/**/*.md', '../assets/mods/{Plugins,Legacy}/**/*.{ts,tsx,js,css,json}'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const allExamples = Object.fromEntries(Object.entries(exampleFiles).map(([path, text]) => [path.split('/assets/mods/')[1], text]))
/** Everything that is seeded or restorable. Legacy sources are never part of it. */
export const MOD_EXAMPLES = Object.fromEntries(Object.entries(allExamples).filter(([path]) => !path.startsWith('Legacy/')))
/** Plugins that are seeded and offered for restore, including the Zoom and Pixel Ruler packages. */
export const OFFICIAL_PLUGINS = listOfficialPlugins(MOD_EXAMPLES)
/** The old trusted sources of plugins that became packages; never seeded, only the baseline for untouched-copy checks. */
export const LEGACY_PLUGINS = listOfficialPlugins(allExamples, 'Legacy')
export const modFs: ModFs = {
  exists, readDir, readTextFile, stat,
  mkdir: (path) => mkdir(path, { recursive: true }),
  writeTextFile: (path, text) => writeTextFile(path, text, { createNew: true }),
}
/** The file system the migration needs: moving files (never deleting) and replacing documentation. */
export const migrationFs: MigrationFs = {
  ...modFs,
  rename: (from, to) => rename(from, to),
  overwriteTextFile: (path, text) => writeTextFile(path, text),
}

export interface ModLibraryPaths extends LibraryPaths { root: string; preferences: string }
let preparation: Promise<ModLibraryPaths> | null = null
export function prepareModLibrary(): Promise<ModLibraryPaths> {
  preparation ??= initializeLibrary().finally(() => { preparation = null })
  return preparation
}

/** Libraries that ship examples: the folder name inside a library root and the matching key of the configured paths. */
const SEEDED = [['Snippets', 'snippets'], ['Plugins', 'plugins'], ['Templates', 'templates']] as const
/** Per-library markers that let an upgrade add newer examples without replacing edited ones. */
const UPGRADE_MARKERS = [['Templates', 'templates', '.complete-templates-v1-seeded'], ['Plugins', 'plugins', '.executable-plugins-v1-seeded'], ['Snippets', 'snippets', '.editorial-snippets-v1-seeded']] as const

async function initializeLibrary(): Promise<ModLibraryPaths> {
  const config = (await configRoot()).replaceAll('\\', '/').replace(/\/$/, '')
  const { managed, ...paths } = await loadLibraryPaths()
  if (!(await exists(config))) await mkdir(config, { recursive: true })
  const root = await ensureModDirectory(modFs, config, 'Mods')
  const isManaged = (key: (typeof SEEDED)[number][1]) => managed?.[key] === true
  // Folders the app picked itself (portable Data, installer content root) are created natively; Mods only keeps its own.
  for (const [folder, key] of SEEDED) if (!isManaged(key)) await ensureModDirectory(modFs, root, folder)
  /**
   * The folder that holds `<Library>/...` examples for this library, or null for a user-chosen folder:
   * never populate a custom directory implicitly. A default is either the original `Mods` library or
   * a folder the native side reports as managed (portable defaults, installer content root).
   */
  const seedBase = (folder: string, key: (typeof SEEDED)[number][1]): string | null => {
    if (paths[key] === `${root}/${folder}`) return root
    if (!isManaged(key)) return null
    const cut = paths[key].lastIndexOf('/')
    return cut > 0 && paths[key].slice(cut + 1).toLowerCase() === folder.toLowerCase() ? paths[key].slice(0, cut) : null
  }
  const grouped = new Map<string, Record<string, string>>([[root, {}]])
  for (const [path, text] of Object.entries(MOD_EXAMPLES)) {
    const entry = SEEDED.find(([folder]) => path.startsWith(`${folder}/`))
    const base = entry && seedBase(entry[0], entry[1])
    if (base) grouped.set(base, { ...grouped.get(base), [path]: text })
  }
  for (const [base, examples] of grouped) await seedExamples(modFs, base, examples)
  for (const [folder, key, marker] of UPGRADE_MARKERS) {
    const base = seedBase(folder, key)
    if (!base || await exists(`${paths[key]}/${marker}`)) continue
    const upgrade = Object.entries(MOD_EXAMPLES).filter(([path]) => path.startsWith(`${folder}/`))
    for (const [relative, contents] of upgrade) {
      const segments = relative.split('/')
      let parent = base
      for (const name of segments.slice(0, -1)) parent = await ensureModDirectory(modFs, parent, name)
      const path = `${parent}/${segments.at(-1)}`
      if (!(await exists(path))) await modFs.writeTextFile(path, contents)
    }
    await modFs.writeTextFile(`${paths[key]}/${marker}`, '1\n')
  }
  return { root, ...paths, preferences: `${config}/mods.json` }
}

export async function readDisabledMods(path: string): Promise<string[]> {
  if (!(await exists(path))) return []
  if ((await stat(path)).size > 256 * 1024) throw new Error('mods.json exceeds 256 KiB')
  const value: unknown = JSON.parse(await readTextFile(path))
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1 || !('disabled' in value)
    || !Array.isArray(value.disabled) || !value.disabled.every((id: unknown) => typeof id === 'string')) {
    throw new Error('Invalid mods.json; keep or repair the file before changing activation settings')
  }
  return [...new Set(value.disabled as string[])]
}

/** Publish a complete preference file; a failed write never truncates the previous settings. */
export async function writeDisabledMods(path: string, disabled: string[]): Promise<void> {
  const temporary = `${path}.${crypto.randomUUID()}.tmp`
  await writeTextFile(temporary, JSON.stringify({ version: 1, disabled: [...new Set(disabled)].sort() }, null, 2), { createNew: true })
  await rename(temporary, path)
}

/** Restores one bundled plugin into the configured Plugins folder, e.g. after it was deleted. */
export async function restoreOfficialPlugin(folder: string): Promise<void> {
  const plugin = OFFICIAL_PLUGINS.find(item => item.folder === folder)
  if (!plugin) throw new Error(`${folder} is not an official plugin`)
  await installOfficialPlugin(modFs, (await prepareModLibrary()).plugins, plugin)
}
