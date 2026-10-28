import { ensureModDirectory, type ModFs } from './modCatalog'
import type { OfficialPlugin } from './officialPlugins'

/** The folders whose old trusted sources became example packages. */
export const MIGRATED_FOLDERS: readonly string[] = ['zoom', 'pixel-ruler']

/** What the migration needs beyond reading: moving files (never deleting) and replacing a document. */
export interface MigrationFs extends ModFs {
  rename(from: string, to: string): Promise<void>
  overwriteTextFile(path: string, text: string): Promise<void>
}

/** Trusted plugins that stay trusted sources but changed code; an untouched old copy is updated in place. */
export const UPDATED_FOLDERS: readonly string[] = ['bookmarks']

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

export interface MigrationResult {
  /** Folder names converted into packages during this run. */
  converted: string[]
  /** Human-readable problems, already prefixed with `Plugins/<folder>`. */
  errors: string[]
}

const message = (error: unknown) => error instanceof Error ? error.message : String(error)

/**
 * Converts an UNTOUCHED old trusted copy of Zoom or Pixel Ruler into the example package, in place.
 * The old code and style files are moved (never deleted) into `<folder>/legacy/`. An edited or
 * extended copy, a folder that already has `manifest.json` and a missing folder are left exactly as
 * they are. The package files are written before anything moves and `manifest.json` last, so a
 * failure at any point leaves a folder that still works; running again is a no-op.
 */
export async function migrateLegacyFolders(
  io: MigrationFs, pluginsDir: string, legacy: OfficialPlugin[], packages: OfficialPlugin[],
): Promise<MigrationResult> {
  const result: MigrationResult = { converted: [], errors: [] }
  let entries
  try { entries = await io.readDir(pluginsDir) } catch (error) {
    result.errors.push(`Plugins: ${message(error)}`)
    return result
  }
  for (const folder of [...MIGRATED_FOLDERS, ...UPDATED_FOLDERS]) {
    const entry = entries.find((item) => item.name.toLowerCase() === folder)
    if (!entry || !entry.isDirectory || entry.isSymlink) continue
    const path = `${pluginsDir}/${entry.name}`
    const baseline = legacy.find((plugin) => plugin.folder === folder)
    const next = packages.find((plugin) => plugin.folder === folder)
    if (UPDATED_FOLDERS.includes(folder)) {
      if (!baseline || !next) continue
      try {
        if (await updateTrustedCopy(io, path, baseline, next)) result.converted.push(folder)
      } catch (error) {
        result.errors.push(`Plugins/${entry.name}: ${message(error)}`)
      }
      continue
    }
    try {
      if (!baseline || !next?.files['manifest.json']) continue
      const present = await io.readDir(path)
      if (present.some((file) => file.name.toLowerCase() === 'manifest.json')) continue
      if (!(await isPristineCopy(io, path, baseline.files))) continue
      for (const relative of Object.keys(next.files)) {
        if (relative === 'manifest.json') continue
        const segments = relative.split('/')
        let parent = path
        for (const name of segments.slice(0, -1)) parent = await ensureModDirectory(io, parent, name)
        await io.overwriteTextFile(`${parent}/${segments.at(-1)}`, next.files[relative])
      }
      await io.overwriteTextFile(`${path}/manifest.json`, next.files['manifest.json'])
      result.converted.push(folder)
    } catch (error) {
      result.errors.push(`Plugins/${entry.name}: ${message(error)}`)
      continue
    }
    try {
      for (const relative of Object.keys(baseline.files).filter((file) => !isDocumentation(file)).sort()) {
        const segments = relative.split('/')
        let parent = await ensureModDirectory(io, path, 'legacy')
        for (const name of segments.slice(0, -1)) parent = await ensureModDirectory(io, parent, name)
        await io.rename(`${path}/${relative}`, `${parent}/${segments.at(-1)}`)
      }
    } catch (error) {
      result.errors.push(`Plugins/${entry.name}: the package was written but moving the old files to legacy/ failed: ${message(error)}`)
    }
  }
  return result
}

/**
 * Replaces an UNTOUCHED old trusted copy by the current sources. The old code and style files are
 * first moved (rename only) into `<folder>/legacy/`, then the new files are written with the entry
 * file last. If anything fails before the new code is complete, the moved files are renamed back,
 * so the folder is the untouched old copy again and the next launch retries. Documentation is
 * replaced last because it cannot be restored. Returns false when the folder must be left alone.
 */
async function updateTrustedCopy(io: MigrationFs, path: string, baseline: OfficialPlugin, next: OfficialPlugin): Promise<boolean> {
  const present = await io.readDir(path)
  if (present.some((file) => file.name.toLowerCase() === 'manifest.json')) return false
  if (!(await isPristineCopy(io, path, baseline.files))) return false
  const code = (files: Record<string, string>) => Object.keys(files).filter((file) => !isDocumentation(file)).sort()
  const moved: [string, string][] = []
  try {
    for (const relative of code(baseline.files)) {
      const segments = relative.split('/')
      let parent = await ensureModDirectory(io, path, 'legacy')
      for (const name of segments.slice(0, -1)) parent = await ensureModDirectory(io, parent, name)
      const target = `${parent}/${segments.at(-1)}`
      await io.rename(`${path}/${relative}`, target)
      moved.push([`${path}/${relative}`, target])
    }
    // The entry file is written last so a half-written folder never has a new entry over old helpers.
    const entry = `${next.folder}.tsx`
    const ordered = [...code(next.files).filter((file) => file !== entry), ...code(next.files).filter((file) => file === entry)]
    for (const relative of ordered) {
      const segments = relative.split('/')
      let parent = path
      for (const name of segments.slice(0, -1)) parent = await ensureModDirectory(io, parent, name)
      await io.overwriteTextFile(`${parent}/${segments.at(-1)}`, next.files[relative])
    }
  } catch (error) {
    const failures: string[] = []
    for (const [original, target] of moved.reverse()) {
      try { await io.rename(target, original) } catch (restore) { failures.push(message(restore)) }
    }
    throw new Error(failures.length
      ? `${message(error)} (restoring the old files also failed: ${failures.join('; ')}; they are in legacy/)`
      : `${message(error)} (the old files were put back)`)
  }
  for (const relative of Object.keys(next.files).filter(isDocumentation)) {
    try {
      const segments = relative.split('/')
      let parent = path
      for (const name of segments.slice(0, -1)) parent = await ensureModDirectory(io, parent, name)
      await io.overwriteTextFile(`${parent}/${segments.at(-1)}`, next.files[relative])
    } catch (error) {
      throw new Error(`the plugin was updated but its documentation could not be written: ${message(error)}`)
    }
  }
  return true
}
