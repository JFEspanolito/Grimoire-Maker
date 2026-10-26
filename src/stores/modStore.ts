import { create } from 'zustand'
import { discoverMods, MOD_KIND, type ModEntry } from '../lib/modCatalog'
import { LEGACY_PLUGINS, migrationFs, modFs, OFFICIAL_PLUGINS, prepareModLibrary, readDisabledMods, restoreOfficialPlugin, writeDisabledMods } from '../lib/modLibrary'
import { missingOfficialPlugins, type OfficialPlugin } from '../lib/officialPlugins'
import { loadUserTemplates } from '../lib/templates'
import { BUILTIN_THEMES } from '../lib/themes'
import type { TemplateSnippet } from '../lib/templateSnippets'
import { useTemplateStore } from './templateStore'
import { useThemeStore } from './themeStore'
import { reconcilePlugins } from '../plugins/plugin-loader'
import { migrateLegacyFolders } from '../lib/migratedPlugins'
import { folderName, sameFolder, syncLocalPackages } from '../lib/localPackages'
import { reportError } from '../lib/errorLogging'

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
    // Convert untouched old Zoom / Pixel Ruler copies into packages before anything reads the folders.
    const migration = await migrateLegacyFolders(migrationFs, paths.plugins, LEGACY_PLUGINS, OFFICIAL_PLUGINS)
      .catch((error): { converted: string[]; errors: string[] } => ({ converted: [], errors: [`Plugins: ${error instanceof Error ? error.message : String(error)}`] }))
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
    const legacy = await loadUserTemplates(taken, { reservedIds: reserved })
    // Package folders run isolated from their own files; the trusted TSX loader never sees them.
    const pluginErrors = await reconcilePlugins(modFs, catalog.mods.filter((mod) => !mod.package))
    const sync = await syncLocalPackages(paths.plugins).catch((error) => {
      reportError('plugin.local.sync', error)
      return null
    })
    const syncErrors = sync?.errors ?? []
    const mods = catalog.mods.map((mod) => {
      const own = mod.package ? syncErrors.filter((item) => sameFolder(item.folder, folderName(mod.folder))) : []
      return own.length ? { ...mod, errors: [...mod.errors, ...own.map((item) => item.message)] } : mod
    })
    const errors = [
      ...migration.errors, ...catalog.errors, ...modern.errors, ...legacy.errors, ...pluginErrors,
      ...syncErrors.map((item) => `Plugins/${item.folder}: ${item.message}`),
    ]
    if (sync) {
      // Activation must not hold up the scan; failures are logged.
      void import('../plugins/isolated/externalHost')
        .then((host) => host.applyLocalPackages(mods, sync))
        .catch((error) => reportError('plugin.external.local', error))
    }
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
