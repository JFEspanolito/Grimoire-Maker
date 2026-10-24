import { prepareThemeBackgrounds } from './themeDecorations'
import { Previewer } from 'pagedjs'
import { invoke } from '@tauri-apps/api/core'
import printCss from '../styles/print.css?raw'
import { PAGE_SIZES, type PageSizeId, type ThemeId } from '../types/document'

/** Everything that decides how the document is paginated. */
export interface PageRequest {
  pageSize: PageSizeId
  columns: 1 | 2
  theme: ThemeId
  bleedMm: number
  marginMm: number
}

export interface ExportRequest extends PageRequest {
  /** Absolute destination chosen by the user (`.pdf`). */
  outputPath?: string
  route?: PdfRoute
}

export const PDF_ROUTE = { FILE: 'file', DIALOG: 'dialog' } as const
export type PdfRoute = (typeof PDF_ROUTE)[keyof typeof PDF_ROUTE]
let exportPending = false

/** Some webviews return before the dialog closes. Never tear down their print DOM early. */
function printDialog(): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = () => {
      window.removeEventListener('afterprint', finish)
      dismiss.remove()
      resolve()
    }
    const dismiss = document.createElement('button')
    dismiss.type = 'button'
    dismiss.textContent = 'Finished with print dialog'
    dismiss.setAttribute('aria-label', 'Print dialog closed: release print preview')
    // Explicit recovery for webviews that never emit afterprint. Do not infer completion from a timer.
    dismiss.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:2147483647;padding:12px;background:#20242e;color:white;border:1px solid currentColor;border-radius:8px'
    dismiss.className = 'print-dialog-dismiss'
    dismiss.addEventListener('click', finish, { once: true })
    window.addEventListener('afterprint', finish, { once: true })
    document.body.append(dismiss)
    try {
      window.print()
    } catch (error) {
      window.removeEventListener('afterprint', finish)
      dismiss.remove()
      reject(error)
    }
  })
}

/** Page rules for this request; they follow the static ones in print.css and override them. */
function pageRules({ pageSize, bleedMm, marginMm }: PageRequest): string {
  const { widthMm, heightMm } = PAGE_SIZES[pageSize]
  return `@page { size: ${widthMm}mm ${heightMm}mm; margin: ${marginMm}mm; bleed: ${bleedMm}mm; marks: ${
    bleedMm > 0 ? 'crop cross' : 'none'
  }; }
.pagedjs_page { background: var(--page-bg); color: var(--page-fg); }
@media print { .print-dialog-dismiss { display: none !important; } }`
}

/** A copy of the editor content, ready to be paginated. The editor itself is never touched. */
function buildContent(request: PageRequest): HTMLElement {
  const source = document.querySelector('[data-active-editor]')
    ? document.querySelector('[data-active-editor="true"] .grimoire-content .ProseMirror')
    : document.querySelector('.grimoire-content .ProseMirror')
  if (!source) throw new Error('Editor content not found')

  const content = document.createElement('div')
  content.className = 'grimoire-page'
  content.style.columnCount = String(request.columns)
  content.innerHTML = `<div class="grimoire-content"><div class="ProseMirror">${source.innerHTML}</div></div>`
  // Editor-only labels would add lines Paged.js measures but the printer never draws.
  content.querySelectorAll('.grimoire-image-chip').forEach((chip) => chip.remove())
  content.querySelectorAll('[data-editor-only], .grimoire-image-resize').forEach((control) => control.remove())
  content.querySelectorAll('.grimoire-content-box').forEach((box) => {
    box.removeAttribute('data-selected')
    box.classList.remove('ProseMirror-selectednode')
    // React node-view wrappers are editing machinery, not extra layout boxes.
    box.querySelectorAll('[data-node-view-content], [data-node-view-content-react]').forEach((wrapper) => wrapper.replaceWith(...wrapper.childNodes))
  })
  return content
}

/**
 * Paginates the current document into `target` with Paged.js. The caller owns
 * `previewer` and must call `previewer.polisher.destroy()` to remove its styles.
 */
export async function paginate(
  previewer: Previewer,
  request: PageRequest,
  target: HTMLElement,
): Promise<void> {
  await prepareThemeBackgrounds(request.theme)
  await previewer.preview(
    buildContent(request),
    [{ 'print.css': printCss }, { 'export.css': pageRules(request) }],
    target,
  )
}

/**
 * Paginates into a print-only container, then asks Rust to print the webview to
 * PDF. The container and Paged.js styles are always removed.
 */
export async function exportPdf(request: ExportRequest): Promise<void> {
  if (exportPending) throw new Error('A PDF export is already running')
  exportPending = true
  const printRoot = document.createElement('div')
  printRoot.className = 'print-root'
  printRoot.dataset.theme = request.theme
  const pages = document.createElement('div')
  printRoot.append(pages)
  document.body.append(printRoot)

  let previewer: Previewer | undefined
  try {
    previewer = new Previewer()
    await paginate(previewer, request, pages)
    await document.fonts.ready
    document.body.classList.add('exporting')
    if (request.route === PDF_ROUTE.DIALOG) {
      await printDialog()
      return
    }
    if (!request.outputPath) throw new Error('PDF output path is required')
    const { widthMm, heightMm } = PAGE_SIZES[request.pageSize]
    await invoke('export_pdf', {
      options: {
        pageWidthMm: widthMm,
        pageHeightMm: heightMm,
        bleedMm: request.bleedMm,
        outputPath: request.outputPath,
      },
    })
  } finally {
    document.body.classList.remove('exporting')
    try {
      previewer?.polisher.destroy()
    } finally {
      printRoot.remove()
      exportPending = false
    }
  }
}
