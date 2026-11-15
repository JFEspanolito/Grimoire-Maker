import { exists, readTextFile } from '@tauri-apps/plugin-fs'
import { isTauri, runFileAction } from '../hooks/useFileSystem'
import { isDocumentRestoring, useDocumentStore } from '../stores/documentStore'
import { useTabStore } from '../stores/tabStore'

/** Git and filesystem saves share one queue; stale editor buffers cannot run after a restore. */
export function restoreGitDocuments(workspace: string, relativePaths: string[] | undefined, operation: () => Promise<void>): Promise<void> {
  return runFileAction(async () => {
    const root = workspace.replaceAll('\\', '/').replace(/\/$/, '')
    const scopes = relativePaths?.length ? relativePaths.map((path) => `${root}/${path.replaceAll('\\', '/')}`) : [root]
    useDocumentStore.getState().beginRestore(scopes)
    const failures: unknown[] = []
    try {
      try { await operation() } catch (error) { failures.push(error) }
      // Also reconcile partial mutations when a later file in a multi-file rollback fails.
      if (isTauri()) {
        const state = useDocumentStore.getState()
        const paths = new Set([...Object.keys(state.buffers), ...useTabStore.getState().paths, ...(state.document.path ? [state.document.path] : [])])
        let removedActiveView = false
        for (const path of paths) {
          if (!isDocumentRestoring(state, path)) continue
          try {
            if (await exists(path)) {
              if (/\.md$/i.test(path)) useDocumentStore.getState().restoreFromDisk(path, await readTextFile(path))
              continue
            }
          } catch (error) {
            failures.push(new Error(`Could not reload restored document ${path}: ${error instanceof Error ? error.message : String(error)}`, { cause: error }))
          }
          // A missing/unreadable clean buffer must not be available to a later autosave.
          const current = useDocumentStore.getState().document
          removedActiveView ||= current.path === path
            || (useTabStore.getState().active === path && current.path === null && !current.dirty)
          useDocumentStore.getState().forget(path)
          useTabStore.getState().remove(path)
        }
        const current = useDocumentStore.getState().document
        // No tab is a valid state for an untitled draft. Choose a fallback only when
        // reconciliation removed the current view and no unrelated work replaced it.
        if (removedActiveView && current.path === null && !current.dirty) {
          const active = useTabStore.getState().active
          if (active && /\.md$/i.test(active)) useDocumentStore.getState().activate(active)
          else useDocumentStore.getState().deactivate()
        }
      }
    } finally {
      useDocumentStore.getState().endRestore()
    }
    if (failures.length === 1) throw failures[0]
    if (failures.length) throw new AggregateError(failures, failures.map((error) => error instanceof Error ? error.message : String(error)).join('; '))
  })
}
