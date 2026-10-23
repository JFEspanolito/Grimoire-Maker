import { Previewer } from 'pagedjs'
import { invoke } from '@tauri-apps/api/core'
import printCss from '../styles/print.css?raw'
import { PAGE_SIZES, type PageSizeId, type ThemeId } from '../types/document'

export interface ExportRequest {
  pageSize: PageSizeId
  columns: 1 | 2
  theme: ThemeId
  bleedMm: number
  marginMm: number
  /** Absolute destination chosen by the user (`.pdf`). */
  outputPath: string
}

/** Page rules for this export; they follow the static ones in print.css and override them. */
function pageRules({ pageSize, bleedMm, marginMm }: ExportRequest): string {
  const { widthMm, heightMm } = PAGE_SIZES[pageSize]
  return `@page { size: ${widthMm}mm ${heightMm}mm; margin: ${marginMm}mm; bleed: ${bleedMm}mm; marks: ${
    bleedMm > 0 ? 'crop cross' : 'none'
  }; }
.pagedjs_page { background: var(--page-bg); color: var(--page-fg); }`
}

/**
 * Paginates the editor content with Paged.js into a print-only container, then asks
 * Rust to print the webview to PDF. The container and Paged.js styles are always removed.
 */
export async function exportPdf(request: ExportRequest): Promise<void> {
  const source = document.querySelector('.grimoire-content .ProseMirror')
  if (!source) throw new Error('Editor content not found')

  const printRoot = document.createElement('div')
  printRoot.className = 'print-root'
  printRoot.dataset.theme = request.theme
  const content = document.createElement('div')
  content.className = 'grimoire-page'
  content.style.columnCount = String(request.columns)
  content.innerHTML = `<div class="grimoire-content"><div class="ProseMirror">${source.innerHTML}</div></div>`
  // Editor-only labels would add lines Paged.js measures but the printer never draws.
  content.querySelectorAll('.grimoire-image-chip').forEach((chip) => chip.remove())
  const pages = document.createElement('div')
  printRoot.append(pages)
  document.body.append(printRoot)

  const previewer = new Previewer()
  try {
    await previewer.preview(content, [{ 'print.css': printCss }, { 'export.css': pageRules(request) }], pages)
    await document.fonts.ready
    document.body.classList.add('exporting')
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
    previewer.polisher.destroy()
    printRoot.remove()
  }
}
