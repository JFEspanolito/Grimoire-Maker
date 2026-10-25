import { useContext } from 'react'
import { DocumentPathContext } from './DocumentPathContext'
import { useDocumentStore } from '../../stores/documentStore'
import { useProjectStore } from '../../stores/projectStore'
import { useThemeStore } from '../../stores/themeStore'
import { resolveTheme } from '../../lib/themes'
import { pageColumns, projectPageText } from '../../lib/pageProperties'
import { PageHeaderFooter } from './PageHeaderFooter'
import { useEffect, useRef, useState, type CSSProperties, type MouseEventHandler, type PointerEventHandler, type ReactNode } from 'react'
import { useSettingsStore } from '../../stores/settingsStore'
import { PAGE_GAP_MM, pageGeometry, sheetCountForHeight } from '../../lib/pageLayout'
import { alignSections } from '../../lib/sectionLayout'
import { usePluginRegistry } from '../../plugins/plugin-manager'
import { useWheelZoom } from '../../hooks/useWheelZoom'
import { EDITOR_ZOOMS } from '../../lib/zoom'
import styles from './PageView.module.css'


/** One continuous editor, flowing down each column and then onto the next sheet. */
export function PageView({ children, onPageClick, onPagePointerDown }: { children: ReactNode; onPageClick?: MouseEventHandler<HTMLDivElement>; onPagePointerDown?: PointerEventHandler<HTMLDivElement> }) {
  const { pageSize, columns: defaultColumns, theme, marginMm, zoom, setZoom, viewMode } = useSettingsStore()
  const path = useContext(DocumentPathContext)
  const current = useDocumentStore(state => path === undefined || state.document.path === path ? state.document : state.buffers[path ?? '__untitled__'])
  const workspace = useDocumentStore(state => state.workspaceRoot)
  const project = useProjectStore(state => workspace ? state.entries[workspace]?.settings : undefined)
  const themes = useThemeStore(state => state.themes)
  const layout = themes.find(item => item.id === resolveTheme(theme, themes))?.headerFooter
  const frontmatter = current?.frontmatter ?? {}
  const columns = pageColumns(frontmatter, defaultColumns)
  const pageText = projectPageText(workspace, frontmatter, project, path)
  const zoomRef = useWheelZoom(zoom, setZoom, EDITOR_ZOOMS)
  const overlays = usePluginRegistry((s) => s.overlays)
  const size = pageGeometry(pageSize, marginMm)
  const flow = useRef<HTMLDivElement>(null)
  const [sheetCount, setSheetCount] = useState(1)
  const paginated = typeof CSS !== 'undefined' && !!CSS.supports?.('column-wrap', 'wrap') && CSS.supports('column-height', '100px')
  const contentHeight = size.contentHeightMm
  const rowGap = size.rowGapMm

  useEffect(() => {
    const element = flow.current
    if (!paginated || !element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      alignSections(element)
      // ResizeObserver measures unzoomed CSS pixels. Allow one pixel of rounding
      // so a fully filled last row does not create a spurious blank sheet.
      const count = sheetCountForHeight(entry.contentRect.height, contentHeight, rowGap)
      setSheetCount(Math.max(1, count))
    })
    observer.observe(element)
    // Text that shrinks inside its padded section changes no size, so edits also trigger alignment.
    let frame = 0
    const edits = new MutationObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => alignSections(element))
    })
    edits.observe(element, { childList: true, characterData: true, subtree: true })
    return () => { observer.disconnect(); edits.disconnect(); cancelAnimationFrame(frame) }
  }, [paginated, contentHeight, rowGap])

  const spreads = paginated && viewMode === 'spreads'
  const visibleSheets = paginated
    ? (spreads ? Math.max(2, sheetCount + (sheetCount % 2)) : sheetCount)
    : 1

  const style: CSSProperties = {
    width: `${size.widthMm}mm`,
    minHeight: `${visibleSheets * size.heightMm + (visibleSheets - 1) * PAGE_GAP_MM}mm`,
    padding: `${marginMm}mm`,
  }
  const flowStyle = {
    '--page-columns': String(columns),
    '--content-height': `${contentHeight}mm`,
    '--row-gap': `${rowGap}mm`,
  }

  return (
    <div ref={zoomRef} className="mx-auto my-8 w-fit" data-editor-zoom style={{ zoom }}>
      {!paginated && <p role="status" className={styles.notice}>Sequential columns require a newer WebView. Showing one editing column; update the WebView to use spreads and matching PDF pagination.</p>}
      <div className={spreads ? styles.spread : undefined}
        data-page-layout={spreads ? 'spreads' : 'pages'}
        style={{ '--page-width': `${size.widthMm}mm`, '--page-height': `${size.heightMm}mm` } as CSSProperties}>
      <div data-editor-stack className={`grimoire-page ${paginated ? styles.pages : ''} relative`} style={style} onClick={onPageClick} onPointerDown={onPagePointerDown}>
        {Array.from({ length: visibleSheets }, (_, index) => <div key={index}>
          {paginated && <div aria-hidden="true" data-editor-sheet={index + 1} className={`grimoire-page ${styles.paper}`}
            style={{ top: `${index * (size.heightMm + PAGE_GAP_MM)}mm`, height: `${size.heightMm}mm` }} />}
          <div className={styles.overlays} style={{ top: `${index * (size.heightMm + PAGE_GAP_MM)}mm`, height: `${size.heightMm}mm` }}>
            <PageHeaderFooter layout={layout} context={{ ...pageText, page: index + 1, pages: visibleSheets }} marginMm={marginMm} />
            {overlays.map(({ id, component: Overlay }) => <Overlay key={id} />)}
          </div>
        </div>)}
        <div ref={flow} className={styles.flow} data-page-flow data-paginated={paginated} style={flowStyle as CSSProperties}>{children}</div>
      </div>
      </div>
    </div>
  )
}
