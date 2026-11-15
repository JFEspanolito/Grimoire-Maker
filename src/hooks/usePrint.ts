import { useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { exportPdf, PDF_ROUTE, type PdfRoute } from '../lib/exportPdf'
import { defaultPdfName, pageRequest, type BookPlan } from '../lib/exportSettings'
import { isTauri } from './useFileSystem'
import { useTabStore } from '../stores/tabStore'
import { friendlyErrorMessage, reportError } from '../lib/errorLogging'
import { useTranslation } from '../lib/i18n'

export const PRINT_NOTICE_EVENT = 'grimoire:print-notice'
export interface PrintNotice {
  message: string
  confirm: boolean
  resolve: (accepted: boolean) => void
}

function showNotice(message: string, confirm: boolean): Promise<boolean> {
  return new Promise(resolve => {
    const notice: PrintNotice = { message, confirm, resolve }
    const event = new CustomEvent(PRINT_NOTICE_EVENT, { detail: notice, cancelable: true })
    window.dispatchEvent(event)
    if (!event.defaultPrevented) resolve(false)
  })
}

/**
 * Export pipeline: the webview paginates with Paged.js (print.css) and the
 * Rust side prints the page to PDF. Browser dev mode falls back to window.print.
 */
export function usePrint() {
  const { t } = useTranslation()
  const pending = useRef(false)
  return async (book?: { plan: BookPlan; contents: HTMLElement[] }) => {
    const active = useTabStore.getState().active
    if (active && !/\.md$/i.test(active)) return
    if (pending.current) return
    pending.current = true
    try {
      const route = isTauri() ? await invoke<PdfRoute>('pdf_export_route') : PDF_ROUTE.DIALOG
      if (route === PDF_ROUTE.DIALOG) {
        if (!await showNotice(t('print.dialogNotice'), true)) return
      }
      const request = { ...pageRequest(book?.plan), suggestedName: route === PDF_ROUTE.FILE ? `${defaultPdfName(book?.plan)}.pdf` : undefined, route }
      if (book) await exportPdf(request, book.contents)
      else await exportPdf(request)
    } catch (e) {
      reportError('pdf.export', e)
      await showNotice(`${t('print.failed')}: ${friendlyErrorMessage(e)}`, false)
    } finally {
      pending.current = false
    }
  }
}
