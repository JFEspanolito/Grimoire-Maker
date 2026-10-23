import { create } from 'zustand'
import { OFFICIAL_TEMPLATES, loadUserTemplates, type Template } from '../lib/templates'
import { BUILTIN_THEMES } from '../lib/themes'
import { useThemeStore } from './themeStore'

interface TemplateState {
  templates: Template[]
  /** User templates folder; null until the first successful scan. */
  dir: string | null
  errors: string[]
  /** Run after the theme scan: package themes must not collide with theme ids. */
  reload: () => Promise<void>
}

export const useTemplateStore = create<TemplateState>((set) => ({
  templates: OFFICIAL_TEMPLATES,
  dir: null,
  errors: [],
  reload: async () => {
    try {
      const themeStore = useThemeStore.getState()
      const taken = new Set([...BUILTIN_THEMES, ...themeStore.userThemes].map((t) => t.id))
      const { dir, templates, themes, errors } = await loadUserTemplates(taken)
      themeStore.setTemplateThemes(themes)
      set({ templates: [...OFFICIAL_TEMPLATES, ...templates], dir, errors })
    } catch (e) {
      set({ errors: [`Could not read the templates folder: ${e instanceof Error ? e.message : String(e)}`] })
    }
  },
}))
