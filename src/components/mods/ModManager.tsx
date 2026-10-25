import { useEffect, useRef, useState } from 'react'
import { friendlyErrorMessage, reportError } from '../../lib/errorLogging'
import { useModStore } from '../../stores/modStore'
import { MOD_KIND, type ModKind } from '../../lib/modCatalog'
import { importModFromPath, pickModSource, type ModImportSource } from '../../lib/modImport'
import { isTauri } from '../../hooks/useFileSystem'
import styles from './ModManager.module.css'

export interface ModManagerProps {
  onClose: () => void
  onEditPaths?: () => void
}

const CATEGORIES: ModKind[] = [
  MOD_KIND.SNIPPETS,
  MOD_KIND.TEMPLATES,
  MOD_KIND.THEMES,
  MOD_KIND.PLUGINS,
]

export function ModManager({ onClose, onEditPaths }: ModManagerProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const { mods, missingOfficial, busy, errors, reload, setEnabled, installOfficial } = useModStore()
  const [activeKind, setActiveKind] = useState<ModKind>(MOD_KIND.SNIPPETS)
  const [actionError, setActionError] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [importKind, setImportKind] = useState<ModKind>(MOD_KIND.SNIPPETS)
  const [importSource, setImportSource] = useState<ModImportSource>('zip')
  const [importSourcePath, setImportSourcePath] = useState('')
  const [importError, setImportError] = useState('')
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    if (isTauri()) void reload().catch(() => undefined)
    return () => element?.close()
  }, [reload])

  const run = async (operation: () => Promise<unknown>) => {
    setActionError('')
    try {
      await operation()
    } catch (error) {
      reportError('mods.action', error)
      setActionError(friendlyErrorMessage(error, 'Could not complete the mod action.'))
    }
  }

  const openImportModal = () => {
    setImportKind(activeKind)
    setImportSource('zip')
    setImportSourcePath('')
    setImportError('')
    setImportOpen(true)
  }

  const handleBrowseImportSource = async () => {
    setImportError('')
    try {
      const picked = await pickModSource(importSource, importKind)
      if (picked) setImportSourcePath(picked)
    } catch (error) {
      reportError('mods.import.browse', error)
      setImportError(friendlyErrorMessage(error, 'Could not select the mod source.'))
    }
  }

  const handleConfirmImport = async () => {
    setImportError('')
    setImporting(true)
    try {
      let targetPath = importSourcePath.trim()
      if (!targetPath) {
        const picked = await pickModSource(importSource, importKind)
        if (!picked) {
          setImporting(false)
          return
        }
        targetPath = picked
        setImportSourcePath(picked)
      }
      await importModFromPath(targetPath, importSource, importKind)
      setActiveKind(importKind)
      setImportOpen(false)
      await reload()
    } catch (error) {
      reportError('mods.import', error)
      setImportError(friendlyErrorMessage(error, 'Could not import the selected mod.'))
    } finally {
      setImporting(false)
    }
  }

  const visibleMods = mods.filter((mod) => mod.kind === activeKind)

  return (
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="mod-manager-title" onCancel={onClose}>
      <header className={styles.header}>
        <h2 id="mod-manager-title">Mod Manager</h2>
        <button type="button" onClick={onClose} aria-label="Close Mod Manager">×</button>
      </header>

      <div className={styles.actions}>
        <button type="button" onClick={() => onEditPaths?.()}>Edit Mods Path</button>
        <button type="button" disabled={busy || !isTauri()} onClick={() => void run(reload)}>Refresh</button>
        <button type="button" disabled={busy || !isTauri()} onClick={openImportModal}>Import Mod</button>
        <button type="button" disabled>Create Mod</button>
        {busy && <span role="status">Loading mods…</span>}
      </div>

      {!isTauri() && <p className={styles.notice}>Folder mods are available in the desktop application.</p>}

      {(actionError || errors.length > 0) && (
        <div role="alert" className={styles.errors}>
          {actionError && <p>{actionError}</p>}
          <ul>{errors.map((error, index) => <li key={`${index}:${error}`}>{error}</li>)}</ul>
        </div>
      )}

      <div className={styles.layout}>
        <nav className={styles.nav} role="tablist" aria-label="Mod categories">
          {CATEGORIES.map((kind) => (
            <button
              key={kind}
              type="button"
              role="tab"
              aria-selected={activeKind === kind}
              onClick={() => setActiveKind(kind)}
            >
              <span>{kind}</span>
              <span className={styles.badge}>{mods.filter((mod) => mod.kind === kind).length}</span>
            </button>
          ))}
        </nav>

        <section className={styles.viewer} role="tabpanel" aria-label={`${activeKind} mods`}>
          <h3 className={styles.viewerTitle}>{activeKind}</h3>
          {activeKind === MOD_KIND.PLUGINS && <p className={styles.description}>
            Trusted local code only. Enabled plugins execute TSX, TS or JS with the app's permissions; they are not sandboxed.
            Copy the complete plugin folder here and refresh. Disable a plugin to unload its controls and registered resources.
          </p>}
          {activeKind === MOD_KIND.PLUGINS && missingOfficial.length > 0 && <div className={styles.list} aria-label="Official plugins not installed">
            {missingOfficial.map((plugin) => <div className={styles.row} key={plugin.folder}>
              <span>
                <strong>{plugin.label}</strong>
                <small>Official plugin, not installed</small>
              </span>
              <button type="button" className={styles.install} disabled={busy} aria-label={`Install official plugin ${plugin.label}`}
                onClick={() => void run(() => installOfficial(plugin.folder))}>Install official plugin</button>
            </div>)}
          </div>}
          {visibleMods.length === 0 ? (
            <p className={styles.description}>
              {activeKind === MOD_KIND.PLUGINS
                ? 'No plugins found. Add a folder with a TSX, TS or JS plugin entry.'
                : `No ${activeKind.toLowerCase()} mods found.`}
            </p>
          ) : (
            <div className={styles.list}>
              {visibleMods.map((mod) => (
                <label className={styles.row} key={mod.id}>
                  <input
                    type="checkbox"
                    checked={mod.enabled}
                    disabled={busy}
                    aria-label={`Enable ${mod.label}`}
                    onChange={(event) => void run(() => setEnabled(mod.id, event.target.checked))}
                  />
                  <span>
                    <strong>{mod.label}</strong>
                    <small>{mod.folder}</small>
                    {mod.errors.length > 0 && (
                      <small className={styles.notice}>Contains invalid files; see errors above.</small>
                    )}
                  </span>
                </label>
              ))}
            </div>
          )}
        </section>
      </div>

      {importOpen && (
        <div className={styles.modalBackdrop} role="dialog" aria-modal="true" aria-labelledby="import-mod-title">
          <div className={styles.modalCard}>
            <header className={styles.modalHeader}>
              <h3 id="import-mod-title">Import Mod</h3>
              <button type="button" onClick={() => setImportOpen(false)} aria-label="Close Import Mod">×</button>
            </header>

            <label className={styles.field}>
              <span>Mod Type</span>
              <select
                aria-label="Mod type"
                value={importKind}
                onChange={(event) => {
                  setImportKind(event.target.value as ModKind)
                  setImportSourcePath('')
                  setImportError('')
                }}
              >
                {CATEGORIES.map((kind) => (
                  <option key={kind} value={kind}>{kind}</option>
                ))}
              </select>
            </label>

            <label className={styles.field}>
              <span>Source Format</span>
              <select
                aria-label="Source format"
                value={importSource}
                onChange={(event) => {
                  setImportSource(event.target.value as ModImportSource)
                  setImportSourcePath('')
                  setImportError('')
                }}
              >
                <option value="zip">{importKind === MOD_KIND.THEMES ? 'ZIP / CSS File' : 'ZIP Archive'}</option>
                <option value="folder">Folder</option>
              </select>
            </label>

            <div className={styles.field}>
              <span>Source Location</span>
              <div className={styles.sourceRow}>
                <input
                  type="text"
                  readOnly
                  aria-label="Selected mod source"
                  placeholder={importSource === 'folder' ? 'Select a mod folder…' : 'Select a mod archive…'}
                  value={importSourcePath}
                />
                <button type="button" disabled={importing} onClick={() => void handleBrowseImportSource()}>
                  Browse…
                </button>
              </div>
            </div>

            {importError && <p role="alert" className={styles.errors}>{importError}</p>}

            <footer className={styles.modalActions}>
              <button type="button" disabled={importing} onClick={() => setImportOpen(false)}>Cancel</button>
              <button type="button" disabled={importing} onClick={() => void handleConfirmImport()}>
                {importing ? 'Importing…' : 'Import'}
              </button>
            </footer>
          </div>
        </div>
      )}
    </dialog>
  )
}
