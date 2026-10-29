import { friendlyErrorMessage, reportError } from '../../lib/errorLogging'
import { lazy, Suspense, useEffect, useEffectEvent, useRef, useState } from 'react'
import { useFileSystem } from '../../hooks/useFileSystem'
import { usePrint } from '../../hooks/usePrint'
import { useDocumentStore } from '../../stores/documentStore'
import { useSettingsStore, type PanelId } from '../../stores/settingsStore'
import { useTranslation } from '../../lib/i18n'
import { useTabStore } from '../../stores/tabStore'
import { PAGE_SIZES, type PageSizeId } from '../../types/document'
import styles from './MenuBar.module.css'
import { ModManager } from '../mods/ModManager'
import { CreateModDialog } from '../mods/CreateModDialog'
import { useImportSection } from '../../stores/explorerStore'
import { NewProjectDialog } from '../project/NewProjectDialog'
import { fileShortcut, findShortcut } from '../../lib/shortcuts'
import { useFindStore } from '../../stores/findStore'
import { selectedSearchText } from '../editor/extensions/searchHighlight'
import { useSessionStore } from '../../stores/sessionStore'
import { AppInfoDialog, type InfoDialogKind } from '../settings/AppInfoDialog'
import { StatisticsDialog } from './StatisticsDialog'
import { ExportPdfDialog, type Book } from './ExportPdfDialog'
import { DocumentOrderDialog } from '../settings/DocumentOrderDialog'
import { PropertiesDialog } from '../settings/PropertiesDialog'
import type { Editor } from '@tiptap/react'
import { insertDivider, insertFloatingBox, insertFormula, insertImage, insertQuote, insertSectionBreak, insertTable } from '../../lib/insertActions'

const PreferencesDialog = lazy(() => import('../settings/PreferencesDialog').then((module) => ({ default: module.PreferencesDialog })))

type Panel = Exclude<PanelId, 'documentIndex'>
interface Props {
  visiblePanels: Record<Panel, boolean>
  onTogglePanel: (panel: Panel) => void
  editor?: Editor | null
}

/** Any open dialog except the floating Find panel, which never blocks the application shortcuts. */
const MODAL_DIALOG = 'dialog[open]:not([data-find-panel])'

export function MenuBar({ visiblePanels, onTogglePanel, editor = null }: Props) {
  const { t } = useTranslation()
  const actions = useFileSystem()
  const print = usePrint()
  const workspace = useDocumentStore((s) => s.workspaceRoot)
  const recent = useSessionStore((s) => s.recentWorkspaces)
  const importSection = useImportSection()
  const readOnly = useTabStore((s) => !!s.active && !/\.md$/i.test(s.active))
  const split = useTabStore((s) => s.split)
  const { pageSize, columns, setPageSize, setColumns, panels, togglePanel } = useSettingsStore()
  const showDocumentIndex = panels.documentIndex
  const [error, setError] = useState('')
  const [modsOpen, setModsOpen] = useState(false)
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [preferencesOpen, setPreferencesOpen] = useState(false)
  const [preferencesSection, setPreferencesSection] = useState<'appearance' | 'folders'>('appearance')
  const [preferencesCustomizing, setPreferencesCustomizing] = useState(false)
  const [templateExportOpen, setTemplateExportOpen] = useState(false)
  const [statisticsOpen, setStatisticsOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [orderOpen, setOrderOpen] = useState(false)
  const [propertiesOpen, setPropertiesOpen] = useState(false)
  const [infoDialog, setInfoDialog] = useState<InfoDialogKind | null>(null)
  const settingsSummary = useRef<HTMLElement>(null)
  const bar = useRef<HTMLElement>(null)
  const closeMenus = () => bar.current?.querySelectorAll('details[open]').forEach((menu) => menu.removeAttribute('open'))
  const openInfo = (kind: InfoDialogKind) => {
    closeMenus()
    settingsSummary.current?.focus()
    setInfoDialog(kind)
  }
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => { if (!bar.current?.contains(event.target as Node)) closeMenus() }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [])
  /** Same flow as Preferences > Customize Theme: Preferences opens straight into the customizer. */
  const openThemeCustomizer = (closeCaller: () => void) => {
    closeCaller()
    setPreferencesSection('appearance')
    setPreferencesCustomizing(true)
    setPreferencesOpen(true)
  }
  const run = async (action: () => unknown | Promise<unknown>) => {
    closeMenus()
    setError('')
    try { await action() } catch (cause) { reportError('menu.action', cause); setError(friendlyErrorMessage(cause)) }
  }
  const openFind = (replace = false) => {
    useFindStore.getState().show({ replace, seed: editor ? selectedSearchText(editor) : undefined })
  }
  const onFileShortcut = useEffectEvent((event: KeyboardEvent) => {
    const find = findShortcut(event)
    if (find === 'find' || find === 'replace') {
      // Always ours: the webview's own find-in-page must never open.
      event.preventDefault()
      if (!document.querySelector(MODAL_DIALOG)) openFind(find === 'replace')
      return
    }
    if (find) {
      if (!useFindStore.getState().open) return
      event.preventDefault()
      useFindStore.getState().requestStep(find === 'next' ? 1 : -1)
      return
    }
    const shortcut = fileShortcut(event)
    if (!shortcut) return
    event.preventDefault()
    if (event.repeat || document.querySelector(MODAL_DIALOG)) return
    void run(() => actions[shortcut]())
  })
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => onFileShortcut(event)
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
  return <><nav ref={bar} className={styles.bar} aria-label="Application menu"
    onKeyDown={(event) => {
      if (event.key === 'Escape') {
        const summary = (event.target as Element).closest('details')?.querySelector('summary')
        closeMenus()
        summary?.focus()
      }
    }}>
    <details name="application-menu">
      <summary>{t('menu.file')}</summary>
      <div className={styles.menu}>
        <button onClick={() => void run(actions.createNewFile)}>{t('menu.file.newFile')}</button>
        <button onClick={() => { closeMenus(); setNewProjectOpen(true) }}>{t('menu.file.newProject')}</button>
        <button onClick={() => void run(() => actions.openFile())}>{t('menu.file.openFile')}</button>
        <button onClick={() => void run(actions.openWorkspace)}>{t('menu.file.openFolder')}</button>
        <details className={styles.recent}>
          <summary>{t('menu.file.recentFolders')}</summary>
          <div role="group" aria-label="Recent folders">
            {recent.length ? recent.map(path => <button key={path} title={path} className={styles.recentPath}
              onClick={() => void run(() => actions.openRecent(path))}>{path}</button>) : <button disabled>{t('menu.file.noRecentFolders')}</button>}
          </div>
        </details>
        <hr />
        <button disabled={readOnly} onClick={() => void run(actions.saveFile)}>{t('menu.file.save')}</button>
        <button onClick={() => void run(actions.saveAll)}>{t('menu.file.saveAll')}</button>
        <hr />
        <button disabled={!workspace || !importSection} title={importSection ? `Import into ${importSection}` : 'Select Draft or Research'} onClick={() => void run(() => actions.importInto())}>{t('menu.file.import')}</button>
        <hr />
        <details className={styles.recent}>
          <summary>{t('menu.file.export')}</summary>
          <div role="group" aria-label="Export">
            <button disabled={readOnly} onClick={() => { closeMenus(); setExportOpen(true) }}>{t('menu.file.exportPdf')}</button>
            <button disabled={!workspace} title={workspace ? 'Export the open project as a template' : 'Open a project first'}
              onClick={() => { closeMenus(); setTemplateExportOpen(true) }}>{t('menu.file.exportAsTemplate')}</button>
          </div>
        </details>
        <hr />
      </div>
    </details>
    <details name="application-menu">
      <summary>{t('menu.view')}</summary>
      <div className={styles.menu}>
        {(['files', 'templates', 'snippets', 'git', 'properties'] as const).map((panel) => <button key={panel}
          aria-label={`${visiblePanels[panel] ? 'Hide' : 'Show'} ${panel} panel`}
          aria-pressed={visiblePanels[panel]} onClick={() => onTogglePanel(panel)}>
          <span className={styles.check} aria-hidden="true">{visiblePanels[panel] ? '✓' : ''}</span>{t(`menu.view.${panel}` as const)}
        </button>)}
        <hr />
        <button aria-label="Split View" aria-pressed={split} onClick={() => void run(() => useTabStore.getState().toggleSplit())}>
          <span className={styles.check} aria-hidden="true">{split ? '✓' : ''}</span>{t('menu.view.splitView')}
        </button>
        <button aria-label="Document Index" aria-pressed={showDocumentIndex} onClick={() => togglePanel('documentIndex')}>
          <span className={styles.check} aria-hidden="true">{showDocumentIndex ? '✓' : ''}</span>{t('menu.view.documentIndex')}
        </button>
      </div>
    </details>
    {!readOnly && <details name="application-menu">
      <summary>{t('menu.insert')}</summary>
      <div className={styles.menu}>
        <button disabled={!editor} onClick={() => void run(() => insertTable(editor!))}>{t('menu.insert.table')}</button>
        <button disabled={!editor} onClick={() => void run(async () => { await insertImage(editor!); await actions.refreshTree() })}>{t('menu.insert.image')}</button>
        <button disabled={!editor} onClick={() => void run(() => insertDivider(editor!))}>{t('menu.insert.horizontalRule')}</button>
        <button disabled={!editor} onClick={() => void run(() => insertQuote(editor!))}>{t('menu.insert.quote')}</button>
        <button disabled={!editor} onClick={() => void run(() => insertFloatingBox(editor!))}>{t('menu.insert.floatingBox')}</button>
        <button disabled={!editor} onClick={() => void run(() => insertFormula(editor!))}>{t('menu.insert.formula')}</button>
        <button disabled={!editor} onClick={() => void run(() => insertSectionBreak(editor!))}>{t('menu.insert.sectionBreak')}</button>
      </div>
    </details>}
    {!readOnly && <details name="application-menu">
      <summary>{t('menu.document')}</summary>
      <div className={styles.menu}>
        <label className={styles.layout}>{t('menu.document.pageSize')}
          <select aria-label="Page size" value={pageSize} onChange={(event) => setPageSize(event.target.value as PageSizeId)}>
            {Object.values(PAGE_SIZES).map((size) => <option key={size.id} value={size.id}>{size.label}</option>)}
          </select>
        </label>
        <label className={styles.layout}>{t('menu.document.columns')}
          <select aria-label="Columns" value={columns} onChange={(event) => setColumns(Number(event.target.value) as 1 | 2)}>
            <option value={1}>1</option>
            <option value={2}>2</option>
          </select>
        </label>
        <hr />
        <button type="button" aria-keyshortcuts="Control+F" onClick={() => { closeMenus(); openFind() }}>{t('menu.document.findAndReplace')}<kbd style={{ float: 'right', marginLeft: '1.5rem', opacity: 0.7, font: 'inherit' }}>Ctrl+F</kbd></button>
        <button type="button" onClick={() => { closeMenus(); setPropertiesOpen(true) }}>{t('menu.document.properties')}</button>
        <button type="button" disabled={!workspace} onClick={() => { closeMenus(); setOrderOpen(true) }}>{t('menu.document.documentOrder')}</button>
        <button type="button" onClick={() => { closeMenus(); setStatisticsOpen(true) }}>{t('menu.document.statistics')}</button>
        <hr />
        <button type="button" onClick={() => { closeMenus(); setExportOpen(true) }}>{t('menu.document.exportPdf')}</button>
      </div>
    </details>}
    <details name="application-menu">
      <summary ref={settingsSummary}>{t('menu.settings')}</summary>
      <div className={styles.menu}>
        <button type="button" onClick={() => { closeMenus(); setModsOpen(true) }}>{t('menu.settings.modManager')}</button>
        <button type="button" onClick={() => { closeMenus(); setPreferencesSection('appearance'); setPreferencesCustomizing(false); setPreferencesOpen(true) }}>{t('menu.settings.preferences')}</button>
        <button type="button" onClick={() => openInfo('about')}>{t('menu.settings.about')}</button>
        <button type="button" onClick={() => openInfo('tutorial')}>{t('menu.settings.tutorial')}</button>
      </div>
    </details>
    {error && <span role="alert" className={styles.error}>{error}</span>}
  </nav>{modsOpen && <ModManager onClose={() => setModsOpen(false)} onEditPaths={() => { setModsOpen(false); setPreferencesSection('folders'); setPreferencesCustomizing(false); setPreferencesOpen(true) }}
    onOpenThemeCustomizer={() => openThemeCustomizer(() => setModsOpen(false))} />}
    {templateExportOpen && <CreateModDialog initialTab="Templates" onClose={() => setTemplateExportOpen(false)}
      onOpenThemeCustomizer={() => openThemeCustomizer(() => setTemplateExportOpen(false))} />}
    {newProjectOpen && <NewProjectDialog onCreate={actions.createProject} onClose={() => setNewProjectOpen(false)} />}
    {preferencesOpen && <Suspense fallback={<span role="status">Loading preferences…</span>}><PreferencesDialog initialSection={preferencesSection} initialCustomizing={preferencesCustomizing} onClose={() => setPreferencesOpen(false)} /></Suspense>}
    {statisticsOpen && <StatisticsDialog onClose={() => setStatisticsOpen(false)} />}
    {propertiesOpen && <PropertiesDialog editor={editor} onClose={() => setPropertiesOpen(false)} />}
    {orderOpen && workspace && <DocumentOrderDialog root={workspace} onClose={() => setOrderOpen(false)} />}
    {exportOpen && <ExportPdfDialog onClose={() => setExportOpen(false)}
      onExport={(book?: Book) => { setExportOpen(false); void run(() => print(book)) }} />}
    {infoDialog && <AppInfoDialog kind={infoDialog} onClose={() => setInfoDialog(null)} />}
  </>
}
