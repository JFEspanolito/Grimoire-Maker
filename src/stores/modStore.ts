import { create } from 'zustand'
import { discoverMods, MOD_KIND, type ModEntry } from '../lib/modCatalog'
import { modFs, OFFICIAL_PLUGINS, prepareModLibrary, readDisabledMods, restoreOfficialPlugin, writeDisabledMods } from '../lib/modLibrary'
import { missingOfficialPlugins, type OfficialPlugin } from '../lib/officialPlugins'
import { loadUserTemplates } from '../lib/templates'
import { BUILTIN_THEMES } from '../lib/themes'
import type { TemplateSnippet } from '../lib/templateSnippets'
import { useTemplateStore } from './templateStore'
import { useThemeStore } from './themeStore'
import { reconcilePlugins } from '../plugins/plugin-loader'
import { officialPlugin } from '../plugins/officialRegistry'
import { reportError } from '../lib/errorLogging'
import { deleteModFiles } from '../lib/modDelete'

interface ModState {
  root: string | null
  ready: boolean
  busy: boolean
  mods: ModEntry[]
  /** Bundled plugins that are not in the Plugins folder. */
  missingOfficial: OfficialPlugin[]
  snippets: TemplateSnippet[]
  errors: string[]
  reload: () => Promise<void>
  setEnabled: (id: string, enabled: boolean) => Promise<void>
  installOfficial: (folder: string) => Promise<void>
  /** Permanently deletes the mod's files, forgets its disabled flag and rescans (which unloads it). */
  deleteMod: (id: string) => Promise<void>
}

let pending: Promise<unknown> = Promise.resolve()
function serial<T>(operation: () => Promise<T>): Promise<T> {
  const next = pending.then(operation)
  pending = next.catch(() => undefined)
  return next
}

export const useModStore = create<ModState>((set, get) => {
  const scan = async () => {
    const paths = await prepareModLibrary()
    set({ root: paths.root })
    const disabled = await readDisabledMods(paths.preferences)
    const catalog = await discoverMods(modFs, paths.root, disabled, { Snippets: paths.snippets, Templates: paths.templates, Themes: paths.themes, Plugins: paths.plugins })
    await useThemeStore.getState().reload().catch(() => undefined)
    const themeStore = useThemeStore.getState()
    const taken = new Set([...BUILTIN_THEMES, ...themeStore.userThemes].map((theme) => theme.id))
    const templateMods = catalog.mods.filter((mod) => mod.kind === MOD_KIND.TEMPLATES)
    const modern = await loadUserTemplates(taken, {
      dir: paths.templates, reservedIds: [], styleId: 'grimoire-mod-template-themes',
      allowedFolders: new Set(templateMods.filter((mod) => mod.enabled && !mod.errors.length).map((mod) => mod.folder.split('/').at(-1)!)),
    })
    // Legacy folders remain readable. A disabled modern package must not reappear via a duplicate legacy ID.
    const reserved = templateMods.map((mod) => mod.folder.split('/').at(-1)!)
    const legacy = await loadUserTemplates(taken, { reservedIds: reserved, skipWhenSameAs: paths.templates })
    // Installed folders select only compiled official implementations, never their mutable source.
    const mods = catalog.mods.filter(mod => mod.kind !== MOD_KIND.PLUGINS || officialPlugin(mod))
      .map(mod => { const plugin = officialPlugin(mod); return plugin ? { ...mod, label: plugin.name } : mod })
    const pluginErrors = await reconcilePlugins(modFs, mods)
    const errors = [
      ...catalog.errors.filter(error => !error.startsWith('Plugins/')),
      ...mods.filter(mod => mod.kind === MOD_KIND.PLUGINS).flatMap(mod => mod.errors.map(error => `${mod.id}: ${error}`)),
      ...modern.errors, ...legacy.errors, ...pluginErrors,
    ]
    themeStore.setTemplateThemes([...modern.themes, ...legacy.themes])
    useTemplateStore.setState({ templates: [...modern.templates, ...legacy.templates], dir: paths.templates, errors })
    set({ mods, missingOfficial: missingOfficialPlugins(OFFICIAL_PLUGINS, mods), snippets: catalog.snippets, ready: true, errors })
  }
  const perform = async (operation: () => Promise<void>) => {
    set({ busy: true })
    try { await operation() } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      set({ errors: [message] })
      useTemplateStore.setState({ errors: [message] })
      throw error
    } finally { set({ busy: false }) }
  }
  return {
    root: null, ready: false, busy: false, mods: [], missingOfficial: [], snippets: [], errors: [],
    reload: () => serial(() => perform(scan)),
    installOfficial: (folder) => serial(() => perform(async () => {
      await restoreOfficialPlugin(folder)
      await scan()
    })),
    deleteMod: (id) => serial(() => perform(async () => {
      const mod = get().mods.find((item) => item.id === id)
      if (!mod) throw new Error('This mod is no longer in the catalog. Refresh first.')
      try {
        await deleteModFiles(mod)
        // The files are gone. A reinstall must not come back silently disabled, but a failure here never undoes the delete.
        try {
          const paths = await prepareModLibrary()
          const disabled = await readDisabledMods(paths.preferences)
          if (disabled.includes(id)) await writeDisabledMods(paths.preferences, disabled.filter((item) => item !== id))
        } catch (error) { reportError('mods.delete.disabled', error) }
      } finally {
        // A delete that failed halfway (a locked file left a partial folder) must still refresh the catalog.
        // The original error keeps propagating; a failing rescan never replaces it.
        try { await scan() } catch (error) { reportError('mods.delete.rescan', error) }
      }
    })),
    setEnabled: (id, enabled) => serial(() => perform(async () => {
      if (!get().mods.some((mod) => mod.id === id)) throw new Error('This mod is no longer in the catalog. Refresh first.')
      const paths = await prepareModLibrary()
      const disabled = new Set(await readDisabledMods(paths.preferences))
      if (enabled) disabled.delete(id); else disabled.add(id)
      await writeDisabledMods(paths.preferences, [...disabled])
      await scan()
    })),
  }
})
