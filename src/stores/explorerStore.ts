import { create } from 'zustand'
import { useTabStore } from './tabStore'
import { useDocumentStore } from './documentStore'
import type { ImportSection } from '../lib/fileImport'

export const useExplorerStore = create<{ selectedPath: string | null; selectPath: (path: string | null) => void }>((set) => ({
  selectedPath: null,
  selectPath: (selectedPath) => set({ selectedPath }),
}))

// A newly focused tab supersedes an earlier explicit folder selection.
useTabStore.subscribe((state, previous) => {
  if (state.active !== previous.active) useExplorerStore.getState().selectPath(null)
})

export function importSectionFor(root: string | null, active: string | null, selected: string | null): ImportSection | null {
  if (!root) return null
  const prefix = `${root.replaceAll('\\', '/').replace(/\/$/, '')}/`
  const normalize = (path: string | null) => path?.replaceAll('\\', '/') ?? ''
  const path = normalize(selected).startsWith(prefix) ? normalize(selected) : normalize(active)
  if (!path.startsWith(prefix)) return 'Draft'
  const section = path.slice(prefix.length).split('/')[0].toLowerCase()
  return section === 'research' ? 'Research' : section === 'trash' ? null : 'Draft'
}

export function currentImportSection(): ImportSection | null {
  return importSectionFor(useDocumentStore.getState().workspaceRoot, useTabStore.getState().active, useExplorerStore.getState().selectedPath)
}

export function useImportSection(): ImportSection | null {
  const root = useDocumentStore((s) => s.workspaceRoot)
  const active = useTabStore((s) => s.active)
  const selected = useExplorerStore((s) => s.selectedPath)
  return importSectionFor(root, active, selected)
}
