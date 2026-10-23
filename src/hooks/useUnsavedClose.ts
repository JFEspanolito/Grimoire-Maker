import { useEffect } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useDocumentStore } from '../stores/documentStore'
import { useSessionStore } from '../stores/sessionStore'
import { isTauri, useFileSystem } from './useFileSystem'

/** A close request must save every buffer, not only the focused pane. */
export function useUnsavedClose() {
  const { saveAll } = useFileSystem()
  useEffect(() => {
    if (!isTauri()) return
    let disposed = false
    let unlisten: (() => void) | undefined
    let saving = false
    const window = getCurrentWindow()
    void window.onCloseRequested((event) => {
      const state = useDocumentStore.getState()
      if (!state.document.dirty && !Object.values(state.buffers).some((document) => document.dirty)) return
      event.preventDefault()
      if (saving) return
      saving = true
      void saveAll().then(async (saved) => { if (saved) await window.close() })
        .catch((error: unknown) => useSessionStore.getState().setWorkspaceError(`Could not save before closing: ${String(error)}`))
        .finally(() => { saving = false })
    }).then((stop) => { if (disposed) stop(); else unlisten = stop })
      .catch((error: unknown) => useSessionStore.getState().setWorkspaceError(`Close protection unavailable: ${String(error)}`))
    return () => { disposed = true; unlisten?.() }
  }, [saveAll])
}
