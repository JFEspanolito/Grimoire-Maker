import { pageColumns, projectPageText } from '../../lib/pageProperties'
import { useProjectStore } from '../../stores/projectStore'
import { useEffect, useRef, useState } from 'react'
import { Previewer } from 'pagedjs'
import { paginate } from '../../lib/exportPdf'
import { reportError } from '../../lib/errorLogging'
import { resolveTheme } from '../../lib/themes'
import { useDocumentStore } from '../../stores/documentStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useThemeStore } from '../../stores/themeStore'
import { usePluginSurface } from '../../plugins/usePluginSurface'
import { usePluginRegistry } from '../../plugins/plugin-manager'
import { PluginBoundary } from '../../plugins/PluginSlot'

type Status =
  | { kind: 'rendering' }
  | { kind: 'ready'; pages: number }
  | { kind: 'error'; message: string }

/** Pagination is slow on long documents; wait for settings and edits to settle. */
const DEBOUNCE_MS = 400

/**
 * Read-only paginated view: the same Paged.js layout the PDF export uses, shown
 * one page at a time or as facing pages (first page on the right, like a book).
 */
export function PagePreview({ mode }: { mode: 'pages' | 'spreads' }) {
  const { pageSize, columns: defaultColumns, theme, bleedMm, marginMm } = useSettingsStore()
  const themes = useThemeStore((s) => s.themes)
  const workspace = useDocumentStore(state => state.workspaceRoot)
  const frontmatter = useDocumentStore(state => state.document.frontmatter)
  const project = useProjectStore(state => workspace ? state.entries[workspace]?.settings : undefined)
  const columns = pageColumns(frontmatter, defaultColumns)
  const body = useDocumentStore((s) => s.document.body)
  const path = useDocumentStore((s) => s.document.path)
  const host = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<Status>({ kind: 'rendering' })
  const [zoom, setZoom] = useState(mode === 'spreads' ? 0.5 : 0.75)
  const zoomRef = usePluginSurface('preview', zoom, setZoom)
  const tools = usePluginRegistry(state => state.previewToolbar)
  const activeTheme = resolveTheme(theme, themes)

  const headerFooter = themes.find(item => item.id === activeTheme)?.headerFooter

  useEffect(() => {
    const container = host.current
    if (!container) return
    // Paged.js mixes layout pixels with bounding rectangles: never paginate
    // under display zoom or the facing-page grid.
    const stage = document.createElement('div')
    stage.dataset.theme = activeTheme
    stage.style.cssText = 'position:fixed;left:-100000px;top:0;width:max-content;visibility:hidden;pointer-events:none'
    const display = document.createElement('div')
    let previewer: Previewer | undefined
    let cancelled = false
    let running = false

    const release = () => {
      // Page resize observers must stop before styles or page DOM disappear.
      previewer?.chunker.removePages()
      // Paged.js creates styleEl during preview(), not in its constructor.
      if (previewer?.polisher.styleEl) previewer.polisher.destroy()
      stage.remove()
      display.remove()
    }

    const timer = window.setTimeout(() => {
      previewer = new Previewer()
      running = true
      setStatus({ kind: 'rendering' })
      document.body.append(stage)
      paginate(previewer, { pageSize, columns, theme: activeTheme, bleedMm, marginMm, headerFooter, pageText: projectPageText(workspace, frontmatter, project, path) }, stage).then(
        () => {
          if (!cancelled) {
            const pages = stage.querySelectorAll('.pagedjs_page').length
            // Static copies have no pagination observers, so display zoom and
            // facing layout cannot restart pagination after it has completed.
            display.replaceChildren(...Array.from(stage.childNodes, node => node.cloneNode(true)))
            previewer?.chunker.removePages()
            container.append(display)
            setStatus({ kind: 'ready', pages })
          }
        },
        (e: unknown) => {
          if (!cancelled) {
            reportError('preview.pages', e)
            setStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
          }
        },
      ).finally(() => {
        running = false
        stage.remove()
        if (cancelled) release()
      })
    }, DEBOUNCE_MS)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
      stage.remove()
      display.remove()
      // An in-flight run still owns its styles; release them once it settles.
      if (!running) release()
    }
  }, [pageSize, columns, activeTheme, bleedMm, marginMm, body, path, headerFooter, workspace, frontmatter, project])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-white/10 bg-neutral-900 px-3 py-1 text-xs text-white/60">
        <span role="status">
          {status.kind === 'rendering' && 'Paginating…'}
          {status.kind === 'ready' && `${status.pages} page${status.pages === 1 ? '' : 's'}`}
          {status.kind === 'error' && <span className="text-red-400">Preview failed: {status.message}</span>}
        </span>
        {tools.map(({ id, title, component: Widget }) => <PluginBoundary key={id} identity={Widget} title={title}>
          <Widget surface={{ kind: 'preview', zoom, setZoom }} />
        </PluginBoundary>)}
      </div>
      <div ref={zoomRef} className="min-h-0 flex-1 overflow-auto">
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
