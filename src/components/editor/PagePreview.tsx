import { useEffect, useRef, useState } from 'react'
import { Previewer } from 'pagedjs'
import { paginate } from '../../lib/exportPdf'
import { resolveTheme } from '../../lib/themes'
import { useDocumentStore } from '../../stores/documentStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useThemeStore } from '../../stores/themeStore'

type Status =
  | { kind: 'rendering' }
  | { kind: 'ready'; pages: number }
  | { kind: 'error'; message: string }

const ZOOMS = [0.4, 0.5, 0.6, 0.75, 1]
/** Pagination is slow on long documents; wait for settings and edits to settle. */
const DEBOUNCE_MS = 400

/**
 * Read-only paginated view: the same Paged.js layout the PDF export uses, shown
 * one page at a time or as facing pages (first page on the right, like a book).
 */
export function PagePreview({ mode }: { mode: 'pages' | 'spreads' }) {
  const { pageSize, columns, theme, bleedMm, marginMm } = useSettingsStore()
  const themes = useThemeStore((s) => s.themes)
  const body = useDocumentStore((s) => s.document.body)
  const path = useDocumentStore((s) => s.document.path)
  const host = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<Status>({ kind: 'rendering' })
  const [zoom, setZoom] = useState(mode === 'spreads' ? 0.5 : 0.75)
  const activeTheme = resolveTheme(theme, themes)

  useEffect(() => {
    const container = host.current
    if (!container) return
    // Each run paginates into its own stage: a superseded run keeps writing to a
    // detached element instead of mixing its pages into the current ones.
    const stage = document.createElement('div')
    const previewer = new Previewer()
    let cancelled = false

    const timer = window.setTimeout(() => {
      setStatus({ kind: 'rendering' })
      container.append(stage)
      paginate(previewer, { pageSize, columns, theme: activeTheme, bleedMm, marginMm }, stage).then(
        () => {
          if (!cancelled) setStatus({ kind: 'ready', pages: stage.querySelectorAll('.pagedjs_page').length })
        },
        (e: unknown) => {
          if (!cancelled) setStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
        },
      )
    }, DEBOUNCE_MS)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
      previewer.polisher.destroy()
      stage.remove()
    }
  }, [pageSize, columns, activeTheme, bleedMm, marginMm, body, path])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-white/10 bg-neutral-900 px-3 py-1 text-xs text-white/60">
        <span role="status">
          {status.kind === 'rendering' && 'Paginating…'}
          {status.kind === 'ready' && `${status.pages} page${status.pages === 1 ? '' : 's'}`}
          {status.kind === 'error' && <span className="text-red-400">Preview failed: {status.message}</span>}
        </span>
        <label className="ml-auto flex items-center gap-1">
          Zoom
          <select
            className="rounded bg-white/10 px-1 py-0.5 text-sm text-white"
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          >
            {ZOOMS.map((z) => (
              <option key={z} value={z} className="text-black">
                {Math.round(z * 100)}%
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <div
          ref={host}
          className="page-preview"
          data-mode={mode}
          data-theme={activeTheme}
          style={{ zoom }}
        />
      </div>
    </div>
  )
}
