import { useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useDocumentStore } from '../stores/documentStore'
import { useSettingsStore } from '../stores/settingsStore'
import { isTauri } from './useFileSystem'

/**
 * Export pipeline: the webview paginates with Paged.js (print.css) and the
 * Rust side prints the page to PDF. Browser dev mode falls back to window.print.
 */
export function usePrint() {
  return useCallback(async () => {
    const { pageSize, bleedMm } = useSettingsStore.getState()
    const title = useDocumentStore.getState().document.frontmatter.title ?? 'grimoire'
    if (!isTauri()) return window.print()
    await invoke('export_pdf', { options: { pageSize, bleedMm, title } })
  }, [])
}
