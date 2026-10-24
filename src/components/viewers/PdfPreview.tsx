import { reportError } from '../../lib/errorLogging'
import { useEffect, useRef, useState } from 'react'
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import styles from './FilePreview.module.css'

GlobalWorkerOptions.workerSrc = workerUrl

export function PdfPreview({ bytes }: { bytes: Uint8Array }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [page, setPage] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [rendering, setRendering] = useState(false)
  const holder = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let cancelled = false
    // A fresh copy survives StrictMode replay: the PDF worker transfers its input buffer.
    const task = getDocument({ data: new Uint8Array(bytes), useWorkerFetch: false, useWasm: false,
      useSystemFonts: true, enableXfa: false, maxImageSize: 16_000_000, canvasMaxAreaInBytes: 64_000_000 })
    void task.promise.then((document) => { if (!cancelled) setPdf(document) }).catch((failure: unknown) => {
      if (!cancelled) { reportError('preview.pdf.load', failure); setError(failure instanceof Error ? failure.message : String(failure)) }
    })
    return () => { cancelled = true; void task.destroy().catch(() => undefined) }
  }, [bytes])

  useEffect(() => {
    if (!pdf || !holder.current) return
    let cancelled = false
    let task: RenderTask | undefined
    // Never reuse a canvas while a cancelled PDF.js render is still settling.
    const canvas = document.createElement('canvas')
    canvas.setAttribute('aria-label', `PDF page ${page} of ${pdf.numPages}`)
    canvas.setAttribute('role', 'img')
    holder.current.replaceChildren(canvas)
    setRendering(true)
    setError(null)
    void (async () => {
      const pdfPage = await pdf.getPage(page)
      if (cancelled) return
      const base = pdfPage.getViewport({ scale: zoom })
      const scale = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(16_000_000 / (base.width * base.height)), 8192 / base.width, 8192 / base.height)
      const viewport = pdfPage.getViewport({ scale: zoom * scale })
      canvas.width = Math.max(1, Math.floor(viewport.width))
      canvas.height = Math.max(1, Math.floor(viewport.height))
      canvas.style.width = `${base.width}px`
      canvas.style.height = `${base.height}px`
      task = pdfPage.render({ canvas, viewport })
      await task.promise
      if (!cancelled) setRendering(false)
    })().catch((failure: unknown) => {
      if (!cancelled) { reportError('preview.pdf.render', failure); setError(failure instanceof Error ? failure.message : String(failure)); setRendering(false) }
    })
    return () => { cancelled = true; task?.cancel(); canvas.remove() }
  }, [pdf, page, zoom])

  return <div>
    <div className={styles.controls} aria-label="PDF controls">
      <button type="button" disabled={!pdf || page === 1} onClick={() => setPage(page - 1)}>Previous page</button>
      <span>Page {page} of {pdf?.numPages ?? '…'}</span>
      <button type="button" disabled={!pdf || page >= pdf.numPages} onClick={() => setPage(page + 1)}>Next page</button>
      <label>Zoom <select aria-label="PDF zoom" value={zoom} onChange={(event) => setZoom(Number(event.target.value))}>
        {[0.5, 0.75, 1, 1.25, 1.5, 2].map((value) => <option key={value} value={value}>{value * 100}%</option>)}
      </select></label>
    </div>
    {error && <p className={styles.notice} role="alert">Could not preview PDF: {error}</p>}
    {(!pdf || rendering) && !error && <p className={styles.notice} role="status">Rendering PDF…</p>}
    <div ref={holder} className={styles.pdf} />
  </div>
}
