import { useRef } from 'react'
import { save } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import { exportPdf, PDF_ROUTE, type PdfRoute } from '../lib/exportPdf'
import { defaultPdfName, pageRequest, type BookPlan } from '../lib/exportSettings'
import { isTauri } from './useFileSystem'
import { useTabStore } from '../stores/tabStore'

/**
 * Export pipeline: the webview paginates with Paged.js (print.css) and the
 * Rust side prints the page to PDF. Browser dev mode falls back to window.print.
 */
export function usePrint() {
  const pending = useRef(false)
  return async (book?: { plan: BookPlan; contents: HTMLElement[] }) => {
    const active = useTabStore.getState().active
    if (active && !/\.md$/i.test(active)) return
    if (pending.current) return
    pending.current = true
    try {
      const route = isTauri() ? await invoke<PdfRoute>('pdf_export_route') : PDF_ROUTE.DIALOG
      const outputPath = route === PDF_ROUTE.FILE ? await save({
        defaultPath: `${defaultPdfName(book?.plan)}.pdf`,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      }) : undefined
      if (route === PDF_ROUTE.FILE && !outputPath) return
      if (route === PDF_ROUTE.DIALOG) {
        window.alert('PDF export opens the system print dialog. Choose Save to PDF (or Print to File). The app cannot confirm whether a file was saved.')
      }
      const request = { ...pageRequest(book?.plan), outputPath: outputPath ?? undefined, route }
      if (book) await exportPdf(request, book.contents)
      else await exportPdf(request)
    } catch (e) {
      console.error('PDF export failed', e)
      window.alert(`PDF export failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      pending.current = false
    }
  }
}
