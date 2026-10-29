import bookmarks from '../assets/mods/Plugins/bookmarks/bookmarks'
import zoomSource from '../assets/mods/Plugins/zoom/manifest.json?raw'
import rulerSource from '../assets/mods/Plugins/pixel-ruler/manifest.json?raw'
import { MOD_KIND, type ModEntry } from '../lib/modCatalog'
import type { ExternalPluginEntry } from '../lib/externalPlugins'
import type { GrimoirePlugin } from '../types/plugin'
import { registerHostContributions } from './isolated/hostContributions'

interface ShippedManifest {
  id: string
  name: string
  version: string
  sdkVersion: number
  permissions: string[]
  contributions: Partial<Pick<ExternalPluginEntry, 'toolbar' | 'behaviors' | 'overlays' | 'tools'>>
}

/** Only build-time assets enter here. No installed manifest or executable is evaluated. */
function declarativePlugin(source: string): GrimoirePlugin {
  const manifest: ShippedManifest = JSON.parse(source)
  const entry: ExternalPluginEntry = {
    id: manifest.id, version: manifest.version, sdkVersion: manifest.sdkVersion,
    permissions: manifest.permissions, fingerprint: 'shipped', source: '', origin: 'local',
    toolbar: manifest.contributions.toolbar ?? [], behaviors: manifest.contributions.behaviors ?? [],
    overlays: manifest.contributions.overlays ?? [], tools: manifest.contributions.tools ?? [],
  }
  return {
    id: manifest.id, name: manifest.name, version: manifest.version,
    activate(api) {
      registerHostContributions(api, entry, () => { throw new Error('Official controls must use host bindings') })
    },
  }
}

const shipped = new Map<string, GrimoirePlugin>([
  ['bookmarks', bookmarks], ['zoom', declarativePlugin(zoomSource)], ['pixel-ruler', declarativePlugin(rulerSource)],
])

/** A folder controls presence only; its name never authorizes running its contents. */
export function officialPlugin(mod: ModEntry): GrimoirePlugin | undefined {
  if (mod.kind !== MOD_KIND.PLUGINS) return undefined
  const folder = mod.folder.replaceAll('\\', '/').replace(/\/+$/, '').split('/').at(-1)?.toLowerCase()
  if (!folder || mod.id !== `Plugins/${folder}`) return undefined
  return shipped.get(folder)
}
