/** Version-one host bridge for trusted local plugins, not a security sandbox. */
export { useSettingsStore as usePageSettings } from '../stores/settingsStore'
export { PAGE_SIZES } from '../types/document'
export { GUIDE_AXIS } from '../types/ruler'
export type { GuideAxis, RulerGuide } from '../types/ruler'
export { editorSheetRect } from '../lib/imagePlacement'
export { readProjectData, writeProjectData } from './projectData'
export type { GrimoirePlugin, PluginApi, PluginSurface, PluginSurfaceWidget, PluginContextAction, PluginContextActionContext } from '../types/plugin'
import { useDocumentStore } from '../stores/documentStore'
import { useTabStore } from '../stores/tabStore'
import { useFileSystem } from '../hooks/useFileSystem'

export function useActivePath(): string | null {
  return useTabStore(state => state.active)
}

/** The focused document, read at call time (for event handlers that are not components). */
export function getActivePath(): string | null {
  return useTabStore.getState().active
}

/** The open project folder, or null before one is chosen. */
export function useWorkspaceRoot(): string | null {
  return useDocumentStore(state => state.workspaceRoot)
}

export function getWorkspaceRoot(): string | null {
  return useDocumentStore.getState().workspaceRoot
}

/** Opens a document in the focused pane, loading it from disk when it is not already open. */
export function useOpenDocument(): (path: string) => Promise<void> {
  const { openFile } = useFileSystem()
  return async (path) => { await openFile(path) }
}
