import { create } from 'zustand'
import { EMPTY_PROJECT, loadProjectSettings, saveProjectSettings, type ProjectSettings } from '../lib/projectSettings'

interface ProjectEntry { settings: ProjectSettings; ready: boolean; busy: boolean; error: string }
export const EMPTY_ENTRY: ProjectEntry = { settings: EMPTY_PROJECT, ready: false, busy: false, error: '' }
interface ProjectState {
  entries: Record<string, ProjectEntry>
  load: (root: string) => Promise<void>
  save: (root: string, settings: ProjectSettings) => Promise<boolean>
}

/** Root-keyed state keeps late reads/writes from leaking into another project. */
export const useProjectStore = create<ProjectState>((set, get) => {
  const update = (root: string, patch: Partial<ProjectEntry>) => set(state => ({ entries: {
    ...state.entries, [root]: { ...(state.entries[root] ?? EMPTY_ENTRY), ...patch },
  } }))
  return {
    entries: {},
    load: async root => {
      if (get().entries[root]?.busy) return
      update(root, { busy: true, ready: false, error: '' })
      try { update(root, { settings: await loadProjectSettings(root), ready: true }) }
      catch (error) { update(root, { settings: EMPTY_PROJECT, error: String(error) }) }
      finally { update(root, { busy: false }) }
    },
    save: async (root, settings) => {
      const entry = get().entries[root]
      if (!entry?.ready || entry.busy) return false
      update(root, { busy: true, error: '' })
      try {
        await saveProjectSettings(root, settings)
        update(root, { settings })
        return true
      } catch (error) { update(root, { error: String(error) }); return false }
      finally { update(root, { busy: false }) }
    },
  }
})
