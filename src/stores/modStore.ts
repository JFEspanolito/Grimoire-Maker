import { create } from 'zustand'
import { discoverMods, MOD_KIND, type ModEntry } from '../lib/modCatalog'
import { modFs, prepareModLibrary, readDisabledMods, writeDisabledMods } from '../lib/modLibrary'
import { loadUserTemplates } from '../lib/templates'
import { BUILTIN_THEMES } from '../lib/themes'
import type { TemplateSnippet } from '../lib/templateSnippets'
import { useTemplateStore } from './templateStore'
import { useThemeStore } from './themeStore'

interface ModState {
  root: string | null
  ready: boolean
  busy: boolean
  mods: ModEntry[]
  snippets: TemplateSnippet[]
  errors: string[]
  reload: () => Promise<void>
  setEnabled: (id: string, enabled: boolean) => Promise<void>
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
    const catalog = await discoverMods(modFs, paths.root, disabled, { Snippets: paths.snippets, Templates: paths.templates })
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
    const errors = [...catalog.errors, ...modern.errors, ...legacy.errors]
    themeStore.setTemplateThemes([...modern.themes, ...legacy.themes])
    useTemplateStore.setState({ templates: [...modern.templates, ...legacy.templates], dir: paths.templates, errors })
    set({ mods: catalog.mods, snippets: catalog.snippets, ready: true, errors })
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
    root: null, ready: false, busy: false, mods: [], snippets: [], errors: [],
    reload: () => serial(() => perform(scan)),
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
