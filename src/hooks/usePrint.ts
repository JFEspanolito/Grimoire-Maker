import { useCallback } from 'react'
import { save } from '@tauri-apps/plugin-dialog'
import { useDocumentStore } from '../stores/documentStore'
import { useSettingsStore } from '../stores/settingsStore'
import { exportPdf } from '../lib/exportPdf'
import { isTauri } from './useFileSystem'

/**
 * Export pipeline: the webview paginates with Paged.js (print.css) and the
 * Rust side prints the page to PDF. Browser dev mode falls back to window.print.
 */
export function usePrint() {
  return useCallback(async () => {
    if (!isTauri()) return window.print()
    const { pageSize, columns, theme, bleedMm, marginMm } = useSettingsStore.getState()
    const title = useDocumentStore.getState().document.frontmatter.title ?? 'grimoire'
    const outputPath = await save({
      defaultPath: `${title}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })
    if (!outputPath) return
    try {
      await exportPdf({ pageSize, columns, theme, bleedMm, marginMm, outputPath })
    } catch (e) {
      console.error('PDF export failed', e)
      window.alert(`PDF export failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }, [])
}
