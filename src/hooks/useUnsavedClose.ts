import { useEffect } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { message } from '@tauri-apps/plugin-dialog'
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

    if (!isTauri()) {
      return () => {
        window.removeEventListener('keydown', onKeyDown)
      }
    }

    let disposed = false
    let unlisten: (() => void) | undefined
    let saving = false
    let discardConfirmed = false
    const tauriWindow = getCurrentWindow()
    void tauriWindow.onCloseRequested((event) => {
      const state = useDocumentStore.getState()
      if (discardConfirmed) return
      if (!state.document.dirty && !Object.values(state.buffers).some((document) => document.dirty)) return
      event.preventDefault()
      if (saving) return
      saving = true
      void (async () => {
        const choice = await message('Save your changes before closing?', {
          title: 'Unsaved changes', kind: 'warning',
          buttons: { yes: 'Save', no: 'Discard', cancel: 'Cancel' },
        })
        if (disposed) return
        if (choice === 'Discard') {
          discardConfirmed = true
          try { await tauriWindow.close() }
          catch (error) { discardConfirmed = false; throw error }
        } else if (choice === 'Save') {
          const saved = await saveAll()
          if (saved && !disposed) await tauriWindow.close()
        }
      })()
        .catch((error: unknown) => useSessionStore.getState().setWorkspaceError(`Could not close window: ${String(error)}`))
        .finally(() => { saving = false })
    }).then((stop) => { if (disposed) stop(); else unlisten = stop })
      .catch((error: unknown) => useSessionStore.getState().setWorkspaceError(`Close protection unavailable: ${String(error)}`))

    return () => {
      disposed = true
      unlisten?.()
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [saveAll])
}
