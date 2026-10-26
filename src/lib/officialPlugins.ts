import { parseDocument } from './frontmatter'
import { ensureModDirectory, modKey, MOD_KIND, type ModEntry, type ModFs } from './modCatalog'

/** A plugin that ships with the application; its source is bundled so it can always be restored. */
export interface OfficialPlugin {
  folder: string
  label: string
  /** Contents by path relative to the plugin folder. */
  files: Record<string, string>
}

/** Groups the bundled `Plugins/<folder>/...` examples by plugin folder. */
export function listOfficialPlugins(examples: Record<string, string>): OfficialPlugin[] {
  const folders = new Map<string, Record<string, string>>()
  for (const [path, contents] of Object.entries(examples)) {
    const [kind, folder, ...rest] = path.split('/')
    if (kind !== 'Plugins' || !folder || !rest.length) continue
    folders.set(folder, { ...folders.get(folder), [rest.join('/')]: contents })
  }
  return [...folders].sort(([a], [b]) => a.localeCompare(b)).map(([folder, files]) => {
    const name = files['index.md'] ? parseDocument(files['index.md']).frontmatter.pluginName : undefined
    return { folder, label: typeof name === 'string' && name ? name : folder, files }
  })
}

/** Official plugins whose folder is not in the catalog, whether never installed or later deleted. */
export function missingOfficialPlugins(official: OfficialPlugin[], mods: ModEntry[]): OfficialPlugin[] {
  const present = new Set(mods.filter(mod => mod.kind === MOD_KIND.PLUGINS).map(mod => mod.id))
  return official.filter(plugin => !present.has(modKey(MOD_KIND.PLUGINS, plugin.folder)))
}

/** Writes the plugin's files into the Plugins folder; files that already exist are never replaced. */
export async function installOfficialPlugin(io: ModFs, pluginsDir: string, plugin: OfficialPlugin): Promise<void> {
  if (!(await io.exists(pluginsDir))) await io.mkdir(pluginsDir)
  const folder = await ensureModDirectory(io, pluginsDir, plugin.folder)
  for (const [relative, contents] of Object.entries(plugin.files)) {
    const segments = relative.split('/')
    let parent = folder
    for (const name of segments.slice(0, -1)) parent = await ensureModDirectory(io, parent, name)
    const path = `${parent}/${segments.at(-1)}`
    if (!(await io.exists(path))) await io.writeTextFile(path, contents)
  }
}
