import { reportError } from '../../lib/errorLogging'
import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useModStore } from '../../stores/modStore'
import { MOD_KIND } from '../../lib/modCatalog'
import { isTauri } from '../../hooks/useFileSystem'
import styles from './ModManager.module.css'

export function ModManager({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const { mods, root, busy, errors, reload, setEnabled } = useModStore()
  const [actionError, setActionError] = useState('')
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    if (isTauri()) void reload().catch(() => undefined)
    return () => element?.close()
  }, [reload])
  const run = async (operation: () => Promise<unknown>) => {
    setActionError('')
    try { await operation() } catch (error) { reportError('mods.action', error); setActionError(error instanceof Error ? error.message : String(error)) }
  }
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="mod-manager-title" onCancel={onClose}>
    <header className={styles.header}>
      <h2 id="mod-manager-title">Mod Manager</h2>
      <button type="button" onClick={onClose} aria-label="Close Mod Manager">×</button>
    </header>
    <p className={styles.description}>Add template or snippet folders to their configured locations, then restart or refresh. Change those locations in Settings → Preferences. Only declarative Markdown is loaded.</p>
    <div className={styles.actions}>
      <button type="button" disabled={!root || busy} onClick={() => void run(() => invoke('open_mods_folder'))}>Open Default Mods Folder</button>
      <button type="button" disabled={busy || !isTauri()} onClick={() => void run(reload)}>Refresh</button>
      {busy && <span role="status">Loading mods…</span>}
    </div>
    {root && <input className={styles.path} aria-label="Default mods folder path" readOnly value={root} onFocus={(event) => event.target.select()} />}
    {!isTauri() && <p className={styles.notice}>Folder mods are available in the desktop application.</p>}
    {(actionError || errors.length > 0) && <div role="alert" className={styles.errors}>
      {actionError && <p>{actionError}</p>}
      <ul>{errors.map((error, index) => <li key={`${index}:${error}`}>{error}</li>)}</ul>
    </div>}
    {Object.values(MOD_KIND).map((kind) => <fieldset className={styles.group} key={kind}>
      <legend>{kind}</legend>
      {!mods.some((mod) => mod.kind === kind) && <p className={styles.description}>No {kind.toLowerCase()} mods found.</p>}
      {mods.filter((mod) => mod.kind === kind).map((mod) => <label className={styles.row} key={mod.id}>
        <input type="checkbox" checked={mod.enabled} disabled={busy} aria-label={`Enable ${mod.label}`}
          onChange={(event) => void run(() => setEnabled(mod.id, event.target.checked))} />
        <span><strong>{mod.label}</strong><small>{mod.folder}</small>
          {mod.errors.length > 0 && <small className={styles.notice}>Contains invalid files; see errors above.</small>}</span>
      </label>)}
    </fieldset>)}
    <footer className={styles.description}>
      Changes apply immediately and survive restarts. Disabling never deletes your mods or existing document content.
      Legacy templates remain available separately; copy them into the configured Template Path to manage them here.
      Executable plugins, including a community Ruler, are reserved for stage 2. The built-in Ruler is unchanged.
    </footer>
  </dialog>
}
