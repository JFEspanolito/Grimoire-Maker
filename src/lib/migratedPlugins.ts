import type { ModEntry, ModFs } from './modCatalog'
import { MOD_KIND, modKey } from './modCatalog'
import type { OfficialPlugin } from './officialPlugins'

/**
 * Official plugins that now ship as isolated bundled packages. Their old trusted sources stay in
 * the application only as the baseline used to tell an untouched local copy from an edited one.
 */
export const MIGRATED_PLUGINS = [
  { folder: 'zoom', id: 'builtin.zoom' },
  { folder: 'pixel-ruler', id: 'builtin.pixel-ruler' },
] as const

export const MIGRATED_FOLDERS: readonly string[] = MIGRATED_PLUGINS.map((plugin) => plugin.folder)

const MAX_FILES = 64

/** Line endings differ between editors; a copy that only changed them is still untouched. */
const normalize = (text: string) => text.replace(/\r\n/g, '\n')

const isDocumentation = (path: string) => /\.md$/i.test(path)

/**
 * True when the folder holds exactly the shipped code and style files with the shipped contents.
 * Markdown files are documentation (older releases shipped different text), so they never count as edits.
 */
export async function isPristineCopy(io: ModFs, folder: string, baseline: Record<string, string>): Promise<boolean> {
  const found: string[] = []
  const walk = async (dir: string, relative: string): Promise<boolean> => {
    for (const entry of await io.readDir(dir)) {
      if (entry.isSymlink) return false
      const path = relative ? `${relative}/${entry.name}` : entry.name
      if (entry.isDirectory) {
        if (!(await walk(`${dir}/${entry.name}`, path))) return false
      } else if (found.push(path) > MAX_FILES) return false
    }
    return true
  }
  try {
    if (!(await walk(folder, ''))) return false
    const expected = Object.keys(baseline).filter((path) => !isDocumentation(path)).sort()
    const present = found.filter((path) => !isDocumentation(path)).sort()
    if (present.length !== expected.length || present.some((path, index) => path !== expected[index])) return false
    for (const path of expected) {
      if (normalize(await io.readTextFile(`${folder}/${path}`)) !== normalize(baseline[path])) return false
    }
    return true
  } catch {
    return false
  }
}

export interface MigrationOutcome {
  /** Trusted folders left unloaded because the bundled isolated version replaces them. */
  replaced: string[]
  /** Isolated plugin ids that must not run because an edited local copy is in use. */
  localWins: string[]
}

/**
 * Decides, per migrated plugin, which implementation runs; never both. An untouched trusted copy
 * is replaced (its files stay on disk); an edited or extended one keeps running and the bundled
 * version stays off, so a user's own changes are never overridden.
 */
export async function resolveMigrations(io: ModFs, mods: ModEntry[], baseline: OfficialPlugin[]): Promise<MigrationOutcome> {
  const outcome: MigrationOutcome = { replaced: [], localWins: [] }
  for (const { folder, id } of MIGRATED_PLUGINS) {
    const mod = mods.find((item) => item.id === modKey(MOD_KIND.PLUGINS, folder))
    const shipped = baseline.find((plugin) => plugin.folder === folder)
    if (!mod || !mod.enabled || !shipped) continue
    if (await isPristineCopy(io, mod.folder, shipped.files)) outcome.replaced.push(mod.id)
    else outcome.localWins.push(id)
  }
  return outcome
}
