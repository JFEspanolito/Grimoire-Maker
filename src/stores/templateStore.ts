import { create } from 'zustand'
import { OFFICIAL_TEMPLATES, type Template } from '../lib/templates'

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
      const { useModStore } = await import('./modStore')
      await useModStore.getState().reload()
    } catch (e) {
      set({ errors: [`Could not read the templates folder: ${e instanceof Error ? e.message : String(e)}`] })
    }
  },
}))
