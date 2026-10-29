import { MOD_KIND, type ModEntry, type ModFs } from '../lib/modCatalog'
import { registerPlugin, unregisterPlugin, usePluginRegistry } from './plugin-manager'
import { officialPlugin } from './officialRegistry'

interface LoadedPlugin { folder: string; pluginId: string }
const loaded = new Map<string, LoadedPlugin>()
const message = (error: unknown) => error instanceof Error ? error.message : String(error)
let pending: Promise<unknown> = Promise.resolve()

/** Reconcile only compiled official plugins. Disk files are never read or executed. */
export function reconcilePlugins(_io: ModFs, mods: ModEntry[]): Promise<string[]> {
  const next = pending.then(() => {
    const errors: string[] = []
    const enabled = mods.filter(mod => mod.kind === MOD_KIND.PLUGINS && mod.enabled && !mod.errors.length)
    const unload = (id: string) => {
      const current = loaded.get(id)
      if (!current) return
      loaded.delete(id)
      try { unregisterPlugin(current.pluginId) } catch (error) { errors.push(`${id}: ${message(error)}`) }
    }
    for (const [id, current] of loaded) {
      if (!enabled.some(mod => mod.id === id && mod.folder === current.folder && officialPlugin(mod))) unload(id)
    }
    for (const mod of enabled) {
      try {
        const plugin = officialPlugin(mod)
        if (!plugin) throw new Error('Only shipped official plugins are supported')
        const current = loaded.get(mod.id)
        if (usePluginRegistry.getState().plugins.some(item => item.id === plugin.id)) {
          if (!current || current.folder === mod.folder) {
            loaded.set(mod.id, { folder: mod.folder, pluginId: plugin.id })
            continue
          }
          unload(mod.id)
          unregisterPlugin(plugin.id)
        }
        unload(mod.id)
        registerPlugin(plugin)
        loaded.set(mod.id, { folder: mod.folder, pluginId: plugin.id })
      } catch (error) {
        unload(mod.id)
        errors.push(`${mod.id}: ${message(error)}`)
      }
    }
    return errors
  })
  pending = next.catch(() => undefined)
  return next
}
