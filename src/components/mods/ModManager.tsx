import { useEffect, useRef, useState } from 'react'
import { friendlyErrorMessage, reportError } from '../../lib/errorLogging'
import { useModStore } from '../../stores/modStore'
import { MOD_KIND, type ModKind } from '../../lib/modCatalog'
import { importModFromPath, pickModSource, type ModImportSource } from '../../lib/modImport'
import { isTauri } from '../../hooks/useFileSystem'
import { folderName } from '../../lib/localPackages'
import { listExternalPlugins, summarizeExternalPlugins, type ExternalPluginSummary } from '../../lib/externalPlugins'
import { setExternalKillSwitch, useExternalRuntime, verifyIsolation } from '../../plugins/isolated/externalHost'
import { ExternalPluginCard } from './ExternalPluginCard'
import { LocalPluginCard } from './LocalPluginCard'
import { PluginCard } from './PluginCard'
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

/** One plain notice shown only when the start-up safety check failed; the technical summary stays behind Details. */
function SafetyBanner({ summary, checking, busy, onRecheck }: { summary: string; checking: boolean; busy: boolean; onRecheck(): void }) {
  const [open, setOpen] = useState(false)
  return (
    <div role="alert" className={styles.banner}>
      <p>Extra tools are switched off because the safety check did not pass on this computer.</p>
      <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>Details</button>
      {open && (
        <div className={styles.bannerDetails}>
          <p>{summary}</p>
          <button type="button" disabled={busy || checking} onClick={onRecheck}>Run check again</button>
        </div>
      )}
    </div>
  )
}

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
  const [external, setExternal] = useState<ExternalPluginSummary[]>([])
  const [switchedOff, setSwitchedOff] = useState(false)
  const running = useExternalRuntime((state) => state.running)
  const isolation = useExternalRuntime((state) => state.isolation)
  const checking = useExternalRuntime((state) => state.checking)

  const loadExternal = async () => {
    const registry = await listExternalPlugins()
    setExternal(summarizeExternalPlugins(registry))
    setSwitchedOff(registry.disabledAll)
  }

  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    if (isTauri()) {
      void reload().catch(() => undefined)
      void loadExternal().catch((error) => reportError('mods.external.list', error))
    }
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
      if (importKind === MOD_KIND.PLUGINS && importSource === 'zip') await loadExternal()
    } catch (error) {
      reportError('mods.import', error)
      setImportError(friendlyErrorMessage(error, 'Could not import the selected mod.'))
    } finally {
      setImporting(false)
    }
  }

  const listed = mods
  const visibleMods = listed.filter((mod) => mod.kind === activeKind)
  // Local packages are listed with the folder plugins; only imported ZIP packages get the imported card.
  const imported = external.filter((plugin) => plugin.source === 'import')
  const hasImported = imported.length > 0

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
              <span className={styles.badge}>{listed.filter((mod) => mod.kind === kind).length}</span>
            </button>
          ))}
        </nav>

        <section className={styles.viewer} role="tabpanel" aria-label={`${activeKind} mods`}>
          <h3 className={styles.viewerTitle}>{activeKind}</h3>
          {activeKind === MOD_KIND.PLUGINS && (
            <div className={styles.intro}>
              <p className={styles.description}>Plugins add extra tools to the editor.</p>
              {hasImported && (
                <button type="button" disabled={busy} aria-pressed={switchedOff}
                  onClick={() => void run(async () => { await setExternalKillSwitch(!switchedOff); await loadExternal() })}>
                  {switchedOff ? 'Allow imported plugins' : 'Turn off all imported plugins'}
                </button>
              )}
            </div>
          )}
          {activeKind === MOD_KIND.PLUGINS && isolation && !isolation.ok && (
            <SafetyBanner summary={isolation.summary} checking={checking} busy={busy}
              onRecheck={() => void run(async () => { await verifyIsolation(true) })} />
          )}
          {activeKind === MOD_KIND.PLUGINS && missingOfficial.length > 0 && <div className={styles.list} aria-label="Official plugins not installed">
            {missingOfficial.map((plugin) => (
              <PluginCard key={plugin.folder} name={plugin.label} origin="Built in" status="Not installed"
                description={plugin.description ?? 'Plugin that comes with the app.'}
                actions={(
                  <button type="button" className={styles.install} disabled={busy} aria-label={`Install official plugin ${plugin.label}`}
                    onClick={() => void run(() => installOfficial(plugin.folder))}>Install</button>
                )}
                details={<p>It is not in your Plugins folder. Install it to put a fresh copy there.</p>} />
            ))}
          </div>}
          {activeKind === MOD_KIND.PLUGINS && imported.length > 0 && <div className={styles.list} aria-label="External plugins">
            {imported.map((plugin) => <ExternalPluginCard key={plugin.id} plugin={plugin} running={running.includes(plugin.id)}
              busy={busy} switchedOff={switchedOff} run={run} refresh={loadExternal} />)}
          </div>}
          {visibleMods.length === 0 ? (
            activeKind === MOD_KIND.PLUGINS && (imported.length > 0 || missingOfficial.length > 0) ? null : (
              <p className={styles.description}>
                {activeKind === MOD_KIND.PLUGINS
                  ? 'No plugins found. Add a folder with a TSX, TS or JS plugin entry.'
                  : `No ${activeKind.toLowerCase()} mods found.`}
              </p>
            )
          ) : activeKind === MOD_KIND.PLUGINS ? (
            <div className={styles.list} aria-label="Local plugins">
              {visibleMods.map((mod) => <LocalPluginCard key={mod.id} mod={mod} busy={busy} setEnabled={setEnabled} run={run}
                record={mod.package ? external.find((plugin) => plugin.source === 'local' && plugin.localFolder?.toLowerCase() === folderName(mod.folder).toLowerCase()) : undefined} />)}
            </div>
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
                <option value="zip">
                  {importKind === MOD_KIND.THEMES ? 'ZIP / CSS File' : importKind === MOD_KIND.PLUGINS ? 'Plugin package (.zip / .gmp)' : 'ZIP Archive'}
                </option>
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

            {importKind === MOD_KIND.PLUGINS && (
              <p className={styles.notice}>
                {importSource === 'zip'
                  ? 'Packages are checked, stored separately, and left disabled and unverified.'
                  : 'A folder is copied as trusted local code and runs with the app\'s permissions.'}
              </p>
            )}
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
