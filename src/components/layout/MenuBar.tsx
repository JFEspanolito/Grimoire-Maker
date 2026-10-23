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

type Panel = 'files' | 'templates' | 'snippets'
interface Props {
  visiblePanels: Record<Panel, boolean>
  onTogglePanel: (panel: Panel) => void
}

export function MenuBar({ visiblePanels, onTogglePanel }: Props) {
  const actions = useFileSystem()
  const print = usePrint()
  const workspace = useDocumentStore((s) => s.workspaceRoot)
  const [error, setError] = useState('')
  const [modsOpen, setModsOpen] = useState(false)
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
        <button onClick={() => void run(() => actions.openFile())}>Open Markdown…</button>
        <button onClick={() => void run(actions.saveFile)}>Save</button>
        <button onClick={() => void run(actions.saveAll)}>Save All</button>
        <hr />
        <button disabled={!workspace} onClick={() => void run(() => actions.importInto('Draft'))}>Import to Draft…</button>
        <button disabled={!workspace} onClick={() => void run(() => actions.importInto('Research'))}>Import to Research…</button>
        <hr />
        <button onClick={() => void run(print)}>Export PDF…</button>
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
        <button onClick={() => void run(() => useSettingsStore.getState().setViewMode('pages'))}>Page Preview</button>
      </div>
    </details>
    <button type="button" onClick={() => { closeMenus(); setModsOpen(true) }}>Mod Manager</button>
    <span className={styles.name}>GRIMOIRE MAKER</span>
    {error && <span role="alert" className={styles.error}>{error}</span>}
  </nav>{modsOpen && <ModManager onClose={() => setModsOpen(false)} />}</>
}
