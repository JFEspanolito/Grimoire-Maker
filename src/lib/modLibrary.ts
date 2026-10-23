import { appConfigDir } from '@tauri-apps/api/path'
import { exists, mkdir, readDir, readTextFile, rename, stat, writeTextFile } from '@tauri-apps/plugin-fs'
import { ensureModDirectory, seedExamples, type ModFs } from './modCatalog'

const exampleFiles = import.meta.glob('../assets/mods/**/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
export const MOD_EXAMPLES = Object.fromEntries(Object.entries(exampleFiles).map(([path, text]) => [path.split('/assets/mods/')[1], text]))
export const modFs: ModFs = {
  exists, readDir, readTextFile, stat,
  mkdir: (path) => mkdir(path, { recursive: true }),
  writeTextFile: (path, text) => writeTextFile(path, text, { createNew: true }),
}

export interface ModLibraryPaths { root: string; templates: string; preferences: string }
let preparation: Promise<ModLibraryPaths> | null = null
export function prepareModLibrary(): Promise<ModLibraryPaths> {
  preparation ??= initializeLibrary().finally(() => { preparation = null })
  return preparation
}

async function initializeLibrary(): Promise<ModLibraryPaths> {
  const config = (await appConfigDir()).replaceAll('\\', '/').replace(/\/$/, '')
  if (!(await exists(config))) await mkdir(config, { recursive: true })
  const root = await ensureModDirectory(modFs, config, 'Mods')
  await ensureModDirectory(modFs, root, 'Snippets')
  await ensureModDirectory(modFs, root, 'Plugins')
  const templates = await ensureModDirectory(modFs, root, 'Templates')
  await seedExamples(modFs, root, MOD_EXAMPLES)
  return { root, templates, preferences: `${config}/mods.json` }
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
