import { useEffect, useRef, useState } from 'react'
import { useFileSystem } from '../../hooks/useFileSystem'
import { usePrint } from '../../hooks/usePrint'
import { useDocumentStore } from '../../stores/documentStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTabStore } from '../../stores/tabStore'
import { ProjectArchiveActions } from '../project/ProjectArchiveActions'
import mark from '../../assets/grimoire-mark.svg'
import styles from './MenuBar.module.css'
import { ModManager } from '../mods/ModManager'
import { useImportSection } from '../../stores/explorerStore'
import { NewProjectDialog } from '../project/NewProjectDialog'

type Panel = 'files' | 'templates' | 'snippets'
interface Props {
  visiblePanels: Record<Panel, boolean>
  onTogglePanel: (panel: Panel) => void
}

export function MenuBar({ visiblePanels, onTogglePanel }: Props) {
  const actions = useFileSystem()
  const print = usePrint()
  const workspace = useDocumentStore((s) => s.workspaceRoot)
  const importSection = useImportSection()
  const readOnly = useTabStore((s) => !!s.active && !/\.md$/i.test(s.active))
  const [error, setError] = useState('')
  const [modsOpen, setModsOpen] = useState(false)
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const bar = useRef<HTMLElement>(null)
  const closeMenus = () => bar.current?.querySelectorAll('details[open]').forEach((menu) => menu.removeAttribute('open'))
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => { if (!bar.current?.contains(event.target as Node)) closeMenus() }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [])
  const run = async (action: () => unknown | Promise<unknown>) => {
    closeMenus()
    setError('')
    try { await action() } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  return <><nav ref={bar} className={styles.bar} aria-label="Application menu"
    onKeyDown={(event) => {
      if (event.key === 'Escape') {
        const summary = (event.target as Element).closest('details')?.querySelector('summary')
        closeMenus()
        summary?.focus()
      }
    }}>
    <img src={mark} alt="" width="22" height="22" />
    <details name="application-menu">
      <summary>File</summary>
      <div className={styles.menu}>
        <button onClick={() => void run(actions.createNewFile)}>New File…</button>
        <button onClick={() => { closeMenus(); setNewProjectOpen(true) }}>New Project…</button>
        <button onClick={() => void run(() => actions.openFile())}>Open File…</button>
        <button onClick={() => void run(actions.openWorkspace)}>Open Folder…</button>
        <hr />
        <button disabled={readOnly} onClick={() => void run(actions.saveFile)}>Save</button>
        <button onClick={() => void run(actions.saveAll)}>Save All</button>
        <hr />
        <button disabled={!workspace || !importSection} title={importSection ? `Import into ${importSection}` : 'Select Draft or Research'} onClick={() => void run(() => actions.importInto())}>Import…</button>
        <hr />
        <button disabled={readOnly} onClick={() => void run(print)}>Export PDF…</button>
      </div>
    </details>
    <details name="application-menu">
      <summary>Project</summary>
      <div className={styles.menu}>
        <button onClick={() => void run(actions.openWorkspace)}>Open Project…</button>
        <hr />
        <ProjectArchiveActions workspacePath={workspace} onRestored={actions.openRestored} />
      </div>
    </details>
    <details name="application-menu">
      <summary>View</summary>
      <div className={styles.menu}>
        {(['files', 'templates', 'snippets'] as const).map((panel) => <button key={panel}
          aria-label={`${visiblePanels[panel] ? 'Hide' : 'Show'} ${panel} panel`}
          aria-pressed={visiblePanels[panel]} onClick={() => onTogglePanel(panel)}>
          {visiblePanels[panel] ? '✓ ' : ''}{panel[0].toUpperCase() + panel.slice(1)}
        </button>)}
        <hr />
        <button onClick={() => void run(() => useTabStore.getState().toggleSplit())}>Toggle Split View</button>
        <button onClick={() => void run(() => useSettingsStore.getState().setViewMode('edit'))}>Edit</button>
        <button disabled={readOnly} onClick={() => void run(() => useSettingsStore.getState().setViewMode('pages'))}>Page Preview</button>
      </div>
    </details>
    <button type="button" onClick={() => { closeMenus(); setModsOpen(true) }}>Mod Manager</button>
    <span className={styles.name}>GRIMOIRE MAKER</span>
    {error && <span role="alert" className={styles.error}>{error}</span>}
  </nav>{modsOpen && <ModManager onClose={() => setModsOpen(false)} />}
    {newProjectOpen && <NewProjectDialog onCreate={actions.createProject} onClose={() => setNewProjectOpen(false)} />}
  </>
}
