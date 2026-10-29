import { useEffect } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useDocumentStore } from '../stores/documentStore'
import { useSessionStore } from '../stores/sessionStore'
import { isTauri, useFileSystem } from './useFileSystem'

/** A close request must save every buffer, not only the focused pane. */
export function useUnsavedClose() {
  const { saveAll } = useFileSystem()
  useEffect(() => {
    // 1. Prevent accidental reload via F5 or Ctrl/Cmd+R
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === 'F5' ||
        ((event.ctrlKey || event.metaKey) && (event.key === 'r' || event.key === 'R'))
      ) {
        event.preventDefault()
      }
    }
    window.addEventListener('keydown', onKeyDown)

    // 2. Confirm before reload/close if there are unsaved changes
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      const state = useDocumentStore.getState()
      const hasUnsaved = state.document.dirty || Object.values(state.buffers).some((document) => document.dirty)
      if (hasUnsaved) {
        event.preventDefault()
        event.returnValue = '¿Estás seguro? Puedes perder los cambios sin guardar.'
        return event.returnValue
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)

    if (!isTauri()) {
      return () => {
        window.removeEventListener('keydown', onKeyDown)
        window.removeEventListener('beforeunload', onBeforeUnload)
      }
    }

    let disposed = false
    let unlisten: (() => void) | undefined
    let saving = false
    const tauriWindow = getCurrentWindow()
    void tauriWindow.onCloseRequested((event) => {
      const state = useDocumentStore.getState()
      if (!state.document.dirty && !Object.values(state.buffers).some((document) => document.dirty)) return
      event.preventDefault()
      if (saving) return
      saving = true
      void saveAll().then(async (saved) => { if (saved) await tauriWindow.close() })
        .catch((error: unknown) => useSessionStore.getState().setWorkspaceError(`Could not save before closing: ${String(error)}`))
        .finally(() => { saving = false })
    }).then((stop) => { if (disposed) stop(); else unlisten = stop })
      .catch((error: unknown) => useSessionStore.getState().setWorkspaceError(`Close protection unavailable: ${String(error)}`))

    return () => {
      disposed = true
      unlisten?.()
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [saveAll])
}
