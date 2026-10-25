import { reportError } from '../../lib/errorLogging'
import { lazy, Suspense, useEffect, useEffectEvent, useRef, useState } from 'react'
import { useFileSystem } from '../../hooks/useFileSystem'
import { usePrint } from '../../hooks/usePrint'
import { useDocumentStore } from '../../stores/documentStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTabStore } from '../../stores/tabStore'
import { PAGE_SIZES, type PageSizeId } from '../../types/document'
import styles from './MenuBar.module.css'
import { ModManager } from '../mods/ModManager'
import { useImportSection } from '../../stores/explorerStore'
import { NewProjectDialog } from '../project/NewProjectDialog'
import { fileShortcut } from '../../lib/shortcuts'
import { useSessionStore } from '../../stores/sessionStore'
import { AppInfoDialog, type InfoDialogKind } from '../settings/AppInfoDialog'

const PreferencesDialog = lazy(() => import('../settings/PreferencesDialog').then((module) => ({ default: module.PreferencesDialog })))

type Panel = 'files' | 'templates' | 'snippets'
interface Props {
  visiblePanels: Record<Panel, boolean>
  onTogglePanel: (panel: Panel) => void
}

export function MenuBar({ visiblePanels, onTogglePanel }: Props) {
  const actions = useFileSystem()
  const print = usePrint()
  const workspace = useDocumentStore((s) => s.workspaceRoot)
  const recent = useSessionStore((s) => s.recentWorkspaces)
  const importSection = useImportSection()
  const readOnly = useTabStore((s) => !!s.active && !/\.md$/i.test(s.active))
  const split = useTabStore((s) => s.split)
  const { pageSize, columns, setPageSize, setColumns } = useSettingsStore()
  const [error, setError] = useState('')
  const [modsOpen, setModsOpen] = useState(false)
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [preferencesOpen, setPreferencesOpen] = useState(false)
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
  const run = async (action: () => unknown | Promise<unknown>) => {
    closeMenus()
    setError('')
    try { await action() } catch (cause) { reportError('menu.action', cause); setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  const onFileShortcut = useEffectEvent((event: KeyboardEvent) => {
    const shortcut = fileShortcut(event)
    if (!shortcut) return
    event.preventDefault()
    if (event.repeat || document.querySelector('dialog[open]')) return
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
      <summary>File</summary>
      <div className={styles.menu}>
        <button onClick={() => void run(actions.createNewFile)}>New File…</button>
        <button onClick={() => { closeMenus(); setNewProjectOpen(true) }}>New Project…</button>
        <button onClick={() => void run(() => actions.openFile())}>Open File…</button>
        <button onClick={() => void run(actions.openWorkspace)}>Open Folder…</button>
        <details className={styles.recent}>
          <summary>Recent Folders</summary>
          <div role="group" aria-label="Recent folders">
            {recent.length ? recent.map(path => <button key={path} title={path} className={styles.recentPath}
              onClick={() => void run(() => actions.openRecent(path))}>{path}</button>) : <button disabled>No recent folders</button>}
          </div>
        </details>
        <hr />
        <button disabled={readOnly} onClick={() => void run(actions.saveFile)}>Save</button>
        <button onClick={() => void run(actions.saveAll)}>Save All</button>
        <hr />
        <button disabled={!workspace || !importSection} title={importSection ? `Import into ${importSection}` : 'Select Draft or Research'} onClick={() => void run(() => actions.importInto())}>Import…</button>
        <hr />
        <button disabled={readOnly} onClick={() => void run(print)}>Export PDF…</button>
        <hr />
      </div>
    </details>
    <details name="application-menu">
      <summary>View</summary>
      <div className={styles.menu}>
        {(['files', 'templates', 'snippets'] as const).map((panel) => <button key={panel}
          aria-label={`${visiblePanels[panel] ? 'Hide' : 'Show'} ${panel} panel`}
          aria-pressed={visiblePanels[panel]} onClick={() => onTogglePanel(panel)}>
          <span className={styles.check} aria-hidden="true">{visiblePanels[panel] ? '✓' : ''}</span>{panel[0].toUpperCase() + panel.slice(1)}
        </button>)}
        <hr />
        <button aria-label="Split View" aria-pressed={split} onClick={() => void run(() => useTabStore.getState().toggleSplit())}>
          <span className={styles.check} aria-hidden="true">{split ? '✓' : ''}</span>Split View
        </button>
        <hr />
        {!readOnly && <><label className={styles.layout}>Page size
          <select aria-label="Page size" value={pageSize} onChange={(event) => setPageSize(event.target.value as PageSizeId)}>
            {Object.values(PAGE_SIZES).map((size) => <option key={size.id} value={size.id}>{size.label}</option>)}
          </select>
        </label>
        <label className={styles.layout}>Columns
          <select aria-label="Columns" value={columns} onChange={(event) => setColumns(Number(event.target.value) as 1 | 2)}>
            <option value={1}>1</option>
            <option value={2}>2</option>
          </select>
        </label></>}
      </div>
    </details>
    <details name="application-menu">
      <summary ref={settingsSummary}>Settings</summary>
      <div className={styles.menu}>
        <button type="button" onClick={() => { closeMenus(); setModsOpen(true) }}>Mod Manager</button>
        <button type="button" onClick={() => { closeMenus(); setPreferencesOpen(true) }}>Preferences…</button>
        <button type="button" onClick={() => openInfo('about')}>About</button>
        <button type="button" onClick={() => openInfo('tutorial')}>Tutorial</button>
      </div>
    </details>
    {error && <span role="alert" className={styles.error}>{error}</span>}
  </nav>{modsOpen && <ModManager onClose={() => setModsOpen(false)} />}
    {newProjectOpen && <NewProjectDialog onCreate={actions.createProject} onClose={() => setNewProjectOpen(false)} />}
    {preferencesOpen && <Suspense fallback={<span role="status">Loading preferences…</span>}><PreferencesDialog onClose={() => setPreferencesOpen(false)} /></Suspense>}
    {infoDialog && <AppInfoDialog kind={infoDialog} onClose={() => setInfoDialog(null)} />}
  </>
}
