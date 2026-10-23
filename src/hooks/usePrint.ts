import { useRef } from 'react'
import { save } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import { useDocumentStore } from '../stores/documentStore'
import { useSettingsStore } from '../stores/settingsStore'
import { exportPdf, PDF_ROUTE, type PdfRoute } from '../lib/exportPdf'
import { resolveTheme } from '../lib/themes'
import { useThemeStore } from '../stores/themeStore'
import { isTauri } from './useFileSystem'
import { useTabStore } from '../stores/tabStore'

/**
 * Export pipeline: the webview paginates with Paged.js (print.css) and the
 * Rust side prints the page to PDF. Browser dev mode falls back to window.print.
 */
export function usePrint() {
  const pending = useRef(false)
  return async () => {
    const active = useTabStore.getState().active
    if (active && !/\.md$/i.test(active)) return
    if (pending.current) return
    pending.current = true
    try {
      const route = isTauri() ? await invoke<PdfRoute>('pdf_export_route') : PDF_ROUTE.DIALOG
      const { pageSize, columns, theme, bleedMm, marginMm } = useSettingsStore.getState()
      const title = useDocumentStore.getState().document.frontmatter.title ?? 'grimoire'
      const outputPath = route === PDF_ROUTE.FILE ? await save({
        defaultPath: `${title}.pdf`,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      }) : undefined
      if (route === PDF_ROUTE.FILE && !outputPath) return
      if (route === PDF_ROUTE.DIALOG) {
        window.alert('PDF export opens the system print dialog. Choose Save to PDF (or Print to File). The app cannot confirm whether a file was saved.')
      }
      await exportPdf({
        pageSize,
        columns,
        theme: resolveTheme(theme, useThemeStore.getState().themes),
        bleedMm, marginMm, outputPath: outputPath ?? undefined, route })
    } catch (e) {
      console.error('PDF export failed', e)
      window.alert(`PDF export failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      pending.current = false
    }
  }
}
