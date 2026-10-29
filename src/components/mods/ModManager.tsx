import { useEffect, useRef, useState } from 'react'
import { friendlyErrorMessage, reportError } from '../../lib/errorLogging'
import { useModStore } from '../../stores/modStore'
import { MOD_KIND, modKey, type ModKind } from '../../lib/modCatalog'
import { importModFromPath, pickModSource, type ModImportSource } from '../../lib/modImport'
import { isTauri } from '../../hooks/useFileSystem'
import { OFFICIAL_PLUGINS } from '../../lib/modLibrary'
import { DeleteModButton } from './DeleteModButton'
import { DetailLine, PluginCard } from './PluginCard'
import { CreateModDialog, CREATE_MOD_TABS, type CreateModTab } from './CreateModDialog'
import { useTranslation, type TranslationKey } from '../../lib/i18n'
import styles from './ModManager.module.css'

export interface ModManagerProps {
  onClose: () => void
  onEditPaths?: () => void
  /** Opens the existing Customize Theme flow; the host closes the Mod Manager. */
  onOpenThemeCustomizer?: () => void
}

const CATEGORIES: ModKind[] = [
  MOD_KIND.SNIPPETS,
  MOD_KIND.TEMPLATES,
  MOD_KIND.THEMES,
  MOD_KIND.PLUGINS,
]

const IMPORT_CATEGORIES = CATEGORIES.filter((kind) => kind !== MOD_KIND.PLUGINS)

const KIND_LABELS: Record<ModKind, TranslationKey> = {
  [MOD_KIND.SNIPPETS]: 'mod.snippets',
  [MOD_KIND.TEMPLATES]: 'mod.templates',
  [MOD_KIND.THEMES]: 'mod.themes',
  [MOD_KIND.PLUGINS]: 'mod.plugins',
}

export function ModManager({ onClose, onEditPaths, onOpenThemeCustomizer }: ModManagerProps) {
  const { t } = useTranslation()
  const dialog = useRef<HTMLDialogElement>(null)
  const { mods, missingOfficial, busy, errors, reload, setEnabled, installOfficial, deleteMod } = useModStore()
  const [activeKind, setActiveKind] = useState<ModKind>(MOD_KIND.SNIPPETS)
  const [actionError, setActionError] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importKind, setImportKind] = useState<ModKind>(MOD_KIND.SNIPPETS)
  const [importSource, setImportSource] = useState<ModImportSource>('zip')
  const [importSourcePath, setImportSourcePath] = useState('')
  const [importError, setImportError] = useState('')
  const [importing, setImporting] = useState(false)
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    if (isTauri()) {
      void reload().catch(() => undefined)
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
    setImportKind(activeKind === MOD_KIND.PLUGINS ? MOD_KIND.SNIPPETS : activeKind)
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

  const listed = mods.filter((mod) => mod.kind !== MOD_KIND.PLUGINS
    || OFFICIAL_PLUGINS.some((plugin) => modKey(MOD_KIND.PLUGINS, plugin.folder) === mod.id))
  const visibleMods = listed.filter((mod) => mod.kind === activeKind)

  return (
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="mod-manager-title" onCancel={onClose}>
      <header className={styles.header}>
        <h2 id="mod-manager-title">{t('mods.title')}</h2>
        <button type="button" onClick={onClose} aria-label={t('mods.close')}>×</button>
      </header>

      <div className={styles.actions}>
        <button type="button" onClick={() => onEditPaths?.()}>{t('mods.editPaths')}</button>
        <button type="button" disabled={busy || !isTauri()} onClick={() => void run(reload)}>{t('mods.refresh')}</button>
        {activeKind !== MOD_KIND.PLUGINS && <button type="button" disabled={busy || !isTauri()} onClick={openImportModal}>{t('mods.importMod')}</button>}
        {activeKind !== MOD_KIND.PLUGINS && <button type="button" onClick={() => setCreateOpen(true)}>{t('mods.createMod')}</button>}
        {busy && <span role="status">{t('mods.loading')}</span>}
      </div>

      {!isTauri() && <p className={styles.notice}>{t('mods.desktopOnly')}</p>}

      {(actionError || errors.length > 0) && (
        <div role="alert" className={styles.errors}>
          {actionError && <p>{actionError}</p>}
          <ul>{errors.map((error, index) => <li key={`${index}:${error}`}>{error}</li>)}</ul>
        </div>
      )}

      <div className={styles.layout}>
        <nav className={styles.nav} role="tablist" aria-label={t('mods.categories')}>
          {CATEGORIES.map((kind) => (
            <button
              key={kind}
              type="button"
              role="tab"
              aria-selected={activeKind === kind}
              onClick={() => setActiveKind(kind)}
            >
              <span>{t(KIND_LABELS[kind])}</span>
              <span className={styles.badge}>{listed.filter((mod) => mod.kind === kind).length}</span>
            </button>
          ))}
        </nav>

        <section className={styles.viewer} role="tabpanel" aria-label={`${activeKind} mods`}>
          <h3 className={styles.viewerTitle}>{t(KIND_LABELS[activeKind])}</h3>
          {activeKind === MOD_KIND.PLUGINS && (
            <div className={styles.intro}>
              <p className={styles.description}>{t('mods.pluginsOfficialOnly')}</p>
            </div>
          )}
          {activeKind === MOD_KIND.PLUGINS && missingOfficial.length > 0 && <div className={styles.list} aria-label={t('mods.notInstalledAria')}>
            {missingOfficial.map((plugin) => (
              <PluginCard key={plugin.folder} name={plugin.label} origin={t('mods.originBuiltIn')} status={t('mods.statusNotInstalled')}
                description={plugin.description ?? t('mods.pluginDefaultDesc')}
                actions={(
                  <button type="button" className={styles.install} disabled={busy} aria-label={`${t('mods.installOfficial')} ${plugin.label}`}
                    onClick={() => void run(() => installOfficial(plugin.folder))}>{t('mods.install')}</button>
                )}
                details={<p>{t('mods.notInFolder')}</p>} />
            ))}
          </div>}
          {visibleMods.length === 0 ? (
            activeKind === MOD_KIND.PLUGINS && missingOfficial.length > 0 ? null : (
              <p className={styles.description}>
                {activeKind === MOD_KIND.PLUGINS
                  ? t('mods.noPluginsInstalled')
                  : `No ${t(KIND_LABELS[activeKind]).toLowerCase()} ${t('mods.noModsFound')}`}
              </p>
            )
          ) : activeKind === MOD_KIND.PLUGINS ? (
            <div className={styles.list} aria-label="Official plugins">
              {visibleMods.map((mod) => {
                const official = OFFICIAL_PLUGINS.find((plugin) => modKey(MOD_KIND.PLUGINS, plugin.folder) === mod.id)!
                return <PluginCard key={mod.id} name={official.label} origin={t('mods.originBuiltIn')}
                  status={mod.errors.length ? t('common.error') : mod.enabled ? t('mods.statusOn') : t('mods.statusOff')}
                  description={official.description ?? t('mods.pluginDefaultDesc')}
                  actions={<button type="button" disabled={busy || mod.errors.length > 0} aria-label={`${t('mods.enable')} ${mod.label}`}
                    aria-pressed={mod.enabled} onClick={() => void run(() => setEnabled(mod.id, !mod.enabled))}>
                    {mod.enabled ? t('mods.turnOff') : t('mods.turnOn')}
                  </button>}
                  details={<>
                    <DetailLine label={t('mods.folder')}>{mod.folder}</DetailLine>
                    <p>{t('mods.runsOfficial')}</p>
                    {mod.errors.length > 0 && <ul aria-label={t('mods.pluginProblems')}>{mod.errors.map((error, index) => <li key={index}>{error}</li>)}</ul>}
                    <DeleteModButton name={official.label} disabled={busy} onConfirm={() => run(() => deleteMod(mod.id))} />
                  </>} />
              })}
            </div>
          ) : (
            <div className={styles.list}>
              {visibleMods.map((mod) => (
                <div className={styles.rowWrap} key={mod.id}>
                  <label className={styles.row}>
                    <input
                      type="checkbox"
                      checked={mod.enabled}
                      disabled={busy}
                      aria-label={`${t('mods.enable')} ${mod.label}`}
                      onChange={(event) => void run(() => setEnabled(mod.id, event.target.checked))}
                    />
                    <span>
                      <strong>{mod.label}</strong>
                      <small>{mod.folder}</small>
                      {mod.errors.length > 0 && (
                        <small className={styles.notice}>{t('mods.invalidFilesNotice')}</small>
                      )}
                    </span>
                  </label>
                  <DeleteModButton name={mod.label} disabled={busy} onConfirm={() => run(() => deleteMod(mod.id))} />
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {createOpen && (
        <CreateModDialog
          initialTab={(CREATE_MOD_TABS as readonly string[]).includes(activeKind) ? activeKind as CreateModTab : 'Themes'}
          onClose={() => setCreateOpen(false)}
          onOpenThemeCustomizer={() => { setCreateOpen(false); onOpenThemeCustomizer?.() }} />
      )}

      {importOpen && (
        <div className={styles.modalBackdrop} role="dialog" aria-modal="true" aria-labelledby="import-mod-title">
          <div className={styles.modalCard}>
            <header className={styles.modalHeader}>
              <h3 id="import-mod-title">{t('mods.importMod')}</h3>
              <button type="button" onClick={() => setImportOpen(false)} aria-label={t('mods.closeImport')}>×</button>
            </header>

            <label className={styles.field}>
              <span>{t('mods.modType')}</span>
              <select
                aria-label={t('mods.modType')}
                value={importKind}
                onChange={(event) => {
                  setImportKind(event.target.value as ModKind)
                  setImportSourcePath('')
                  setImportError('')
                }}
              >
                {IMPORT_CATEGORIES.map((kind) => (
                  <option key={kind} value={kind}>{t(KIND_LABELS[kind])}</option>
                ))}
              </select>
            </label>

            <label className={styles.field}>
              <span>{t('mods.sourceFormat')}</span>
              <select
                aria-label={t('mods.sourceFormat')}
                value={importSource}
                onChange={(event) => {
                  setImportSource(event.target.value as ModImportSource)
                  setImportSourcePath('')
                  setImportError('')
                }}
              >
                <option value="zip">
                  {importKind === MOD_KIND.THEMES ? t('mods.formatZipCss') : t('mods.formatZipArchive')}
                </option>
                <option value="folder">{t('mods.formatFolder')}</option>
              </select>
            </label>

            <div className={styles.field}>
              <span>{t('mods.sourceLocation')}</span>
              <div className={styles.sourceRow}>
                <input
                  type="text"
                  readOnly
                  aria-label={t('mods.selectedModSource')}
                  placeholder={importSource === 'folder' ? t('mods.selectModFolder') : t('mods.selectModArchive')}
                  value={importSourcePath}
                />
                <button type="button" disabled={importing} onClick={() => void handleBrowseImportSource()}>
                  {t('mods.browse')}
                </button>
              </div>
            </div>

            {importError && <p role="alert" className={styles.errors}>{importError}</p>}

            <footer className={styles.modalActions}>
              <button type="button" disabled={importing} onClick={() => setImportOpen(false)}>{t('common.cancel')}</button>
              <button type="button" disabled={importing} onClick={() => void handleConfirmImport()}>
                {importing ? t('mods.importing') : t('mods.importAction')}
              </button>
            </footer>
          </div>
        </div>
      )}
    </dialog>
  )
}
