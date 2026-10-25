import { useEffect, useRef, useState } from 'react'
import { reportError } from '../../lib/errorLogging'
import { loadBookContents } from '../../lib/bookContent'
import { pageRequest, planBook, type BookPlan } from '../../lib/exportSettings'
import { renderBook } from '../../lib/exportPdf'
import { useDocumentStore } from '../../stores/documentStore'
import { useProjectStore } from '../../stores/projectStore'
import styles from './ExportPdfDialog.module.css'

type Status =
  | { kind: 'loading' }
  | { kind: 'ready'; sheets: number }
  | { kind: 'empty' }
  | { kind: 'error'; message: string }
export interface Book { plan: BookPlan; contents: HTMLElement[] }

const ZOOMS = [0.25, 0.35, 0.5, 0.75, 1]

/** Shows the whole book as it will be printed before the PDF is written. */
export function ExportPdfDialog({ onClose, onExport }: { onClose: () => void; onExport: (book?: Book) => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const display = useRef<HTMLDivElement>(null)
  const book = useRef<Book | undefined>(undefined)
  const [status, setStatus] = useState<Status>({ kind: 'loading' })
  const [zoom, setZoom] = useState(0.35)
  const theme = pageRequest().theme

  useEffect(() => {
    const element = dialog.current
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    element?.showModal()
    return () => {
      element?.close()
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    // Layout is measured in an unzoomed, off-screen stage; the visible copy is only scaled.
    const stage = document.createElement('div')
    stage.dataset.theme = theme
    stage.style.cssText = 'position:fixed;left:-100000px;top:0;width:max-content;visibility:hidden;pointer-events:none'
    document.body.append(stage)
    void (async () => {
      try {
        const root = useDocumentStore.getState().workspaceRoot
        if (root && !useProjectStore.getState().entries[root]?.ready) await useProjectStore.getState().load(root)
        const plan = planBook()
        if (plan && !plan.documents.length) { if (!cancelled) setStatus({ kind: 'empty' }); return }
        const request = pageRequest(plan ?? undefined)
        const contents = plan ? await loadBookContents(plan.root, plan.documents, request.columns) : undefined
        if (cancelled) return
        const sheets = await renderBook(request, stage, contents)
        if (cancelled) return
        book.current = plan && contents ? { plan, contents } : undefined
        display.current?.replaceChildren(...Array.from(stage.childNodes, (node) => node.cloneNode(true)))
        setStatus({ kind: 'ready', sheets })
      } catch (error) {
        if (!cancelled) { reportError('export.preview', error); setStatus({ kind: 'error', message: error instanceof Error ? error.message : String(error) }) }
      } finally {
        stage.remove()
      }
    })()
    return () => { cancelled = true; stage.remove() }
  }, [theme])

  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="export-pdf-title"
    onCancel={(event) => { event.preventDefault(); onClose() }}>
    <header className={styles.header}>
      <h2 id="export-pdf-title">Export PDF</h2>
      <label className={styles.zoom}>Zoom
        <select aria-label="Preview zoom" value={zoom} onChange={(event) => setZoom(Number(event.target.value))}>
          {ZOOMS.map((value) => <option key={value} value={value}>{Math.round(value * 100)}%</option>)}
        </select>
      </label>
      <button type="button" className={styles.dismiss} aria-label="Close Export PDF" onClick={onClose}>×</button>
    </header>
    <div className={styles.preview} data-theme={theme}>
      {status.kind === 'loading' && <p role="status">Preparing preview…</p>}
      {status.kind === 'empty' && <p role="status">No documents are selected. Choose some in Document → Document Order…</p>}
      {status.kind === 'error' && <p role="alert">Preview failed: {status.message}</p>}
      <div ref={display} className={styles.sheets} style={{ zoom }} hidden={status.kind !== 'ready'} />
    </div>
    <footer className={styles.footer}>
      <span role="status">{status.kind === 'ready' ? `${status.sheets} page${status.sheets === 1 ? '' : 's'}` : ''}</span>
      <button type="button" onClick={onClose}>Cancel</button>
      <button type="button" className={styles.primary} disabled={status.kind !== 'ready'} onClick={() => onExport(book.current)}>Export PDF…</button>
    </footer>
  </dialog>
}
