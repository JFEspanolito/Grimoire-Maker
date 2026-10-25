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
import { PAGE_SIZES } from '../../types/document'
import { usePluginRegistry } from '../../plugins/plugin-manager'
import { useWheelZoom } from '../../hooks/useWheelZoom'
import { EDITOR_ZOOMS } from '../../lib/zoom'
import styles from './PageView.module.css'

const PAGE_GAP_MM = 8
const PX_PER_MM = 96 / 25.4

/** One continuous editor, flowing down each column and then onto the next sheet. */
export function PageView({ children, onPageClick, onPagePointerDown }: { children: ReactNode; onPageClick?: MouseEventHandler<HTMLDivElement>; onPagePointerDown?: PointerEventHandler<HTMLDivElement> }) {
  const { pageSize, columns: defaultColumns, theme, marginMm, zoom, setZoom } = useSettingsStore()
  const path = useContext(DocumentPathContext)
  const current = useDocumentStore(state => path === undefined || state.document.path === path ? state.document : state.buffers[path ?? '__untitled__'])
  const workspace = useDocumentStore(state => state.workspaceRoot)
  const project = useProjectStore(state => workspace ? state.entries[workspace]?.settings : undefined)
  const themes = useThemeStore(state => state.themes)
  const layout = themes.find(item => item.id === resolveTheme(theme, themes))?.headerFooter
  const frontmatter = current?.frontmatter ?? {}
  const columns = pageColumns(frontmatter, defaultColumns)
  const pageText = projectPageText(workspace, frontmatter, project)
  const zoomRef = useWheelZoom(zoom, setZoom, EDITOR_ZOOMS)
  const overlays = usePluginRegistry((s) => s.overlays)
  const size = PAGE_SIZES[pageSize]
  const flow = useRef<HTMLDivElement>(null)
  const [sheetCount, setSheetCount] = useState(1)
  const paginated = typeof CSS !== 'undefined' && !!CSS.supports?.('column-wrap', 'wrap') && CSS.supports('column-height', '100px')
  const contentHeight = Math.max(1, size.heightMm - 2 * marginMm)
  const rowGap = 2 * marginMm + PAGE_GAP_MM

  useEffect(() => {
    const element = flow.current
    if (!paginated || !element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      // ResizeObserver measures unzoomed CSS pixels. Allow one pixel of rounding
      // so a fully filled last row does not create a spurious blank sheet.
      const count = Math.ceil((entry.contentRect.height + rowGap * PX_PER_MM - 1) / ((contentHeight + rowGap) * PX_PER_MM))
      setSheetCount(Math.max(1, count))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [paginated, contentHeight, rowGap])

  const visibleSheets = paginated ? sheetCount : 1

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
      {!paginated && <p role="status" className={styles.notice}>Sequential columns require a newer WebView. Showing one editing column; Page View and PDF keep your column setting.</p>}
      <div className={`grimoire-page ${paginated ? styles.pages : ''} relative`} style={style} onClick={onPageClick} onPointerDown={onPagePointerDown}>
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
  )
}
