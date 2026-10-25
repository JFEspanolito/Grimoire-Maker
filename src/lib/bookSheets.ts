import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PageHeaderFooter } from '../components/editor/PageHeaderFooter'
import type { PageRequest } from './exportPdf'

/**
 * Documents are paginated one by one, so each restarted its own page numbers. Once every
 * document is in place, number all sheets as one book and rewrite their header and footer.
 */
export function renumberSheets(request: PageRequest, target: HTMLElement): number {
  const sheets = Array.from(target.querySelectorAll<HTMLElement>('.native-print-sheet'))
  sheets.forEach((sheet, index) => {
    sheet.dataset.printSheet = String(index + 1)
    const text = sheet.querySelector('[data-theme-page-text]')
    if (!text) return
    text.outerHTML = renderToStaticMarkup(createElement(PageHeaderFooter, {
      layout: request.headerFooter,
      context: { ...request.pageText, page: index + 1, pages: sheets.length },
      marginMm: request.marginMm,
    }))
  })
  // Each document appended the same page rule; one is enough.
  target.querySelectorAll('style[data-native-print-style]').forEach((style, index) => { if (index > 0) style.remove() })
  return sheets.length
}
