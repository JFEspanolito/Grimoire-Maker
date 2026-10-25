import { useEffect, useRef, useState } from 'react'
import { changeLibraryPath, loadLibraryPaths, type LibraryKind, type LibraryPaths } from '../../lib/preferences'
import { isTauri } from '../../hooks/useFileSystem'
import { useSettingsStore } from '../../stores/settingsStore'
import { useThemeStore } from '../../stores/themeStore'
import { useTemplateStore } from '../../stores/templateStore'
import { resolveTheme } from '../../lib/themes'
import styles from './PreferencesDialog.module.css'
import { ThemeCustomizer } from './ThemeCustomizer'
import { EDITOR_SHORTCUTS, FILE_SHORTCUTS, ZOOM_SHORTCUTS } from '../../lib/shortcuts'
import { reportError } from '../../lib/errorLogging'
import { ProjectSettings } from './ProjectSettings'
import { AutoSaveSettings } from './AutoSaveSettings'

const PATH_FIELDS: { kind: LibraryKind; label: string }[] = [
  { kind: 'plugins', label: 'Plugin Path' },
  { kind: 'snippets', label: 'Snippet Path' },
  { kind: 'templates', label: 'Template Path' },
  { kind: 'themes', label: 'Theme Path' },
  { kind: 'logs', label: 'Logs Path' },
]

const SECTIONS = { appearance: 'Appearance', folders: 'Content folders', shortcuts: 'Shortcuts', autosave: 'Auto save', project: 'Project' } as const
type Section = keyof typeof SECTIONS
const SECTION_IDS = Object.keys(SECTIONS) as Section[]

export function PreferencesDialog({ onClose }: { onClose: () => void }) {
  const desktop = isTauri()
  const dialog = useRef<HTMLDialogElement>(null)
  const locked = useRef(false)
  const [paths, setPaths] = useState<LibraryPaths | null>(null)
  const [loading, setLoading] = useState(desktop)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [customizing, setCustomizing] = useState(false)
  const [section, setSection] = useState<Section>('appearance')
  const { theme, setTheme } = useSettingsStore()
  const { themes, errors: themeErrors } = useThemeStore()

  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])

  useEffect(() => {
    let cancelled = false
    if (!desktop) return
    void loadLibraryPaths().then(
      (value) => { if (!cancelled) setPaths(value) },
      (cause: unknown) => { if (!cancelled) { reportError('preferences.load', cause); setError(String(cause instanceof Error ? cause.message : cause)) } },
    ).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [attempt, desktop])

  const changePath = async (kind: LibraryKind) => {
    if (locked.current) return
    locked.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const updated = await changeLibraryPath(kind)
      if (!updated) return
      setPaths(updated)
      if (kind === 'logs') {
        setNotice('Logs folder updated. Existing logs were copied; new errors are recorded there without restarting.')
        return
      }
      // Templates may provide themes, so preserve the existing load order.
      await useThemeStore.getState().reload()
      await useTemplateStore.getState().reload()
      const errors = [...useThemeStore.getState().errors, ...useTemplateStore.getState().errors]
      if (errors.length) {
        setError(`The new folder was saved, but some content could not be reloaded: ${errors.join('; ')}`)
      } else {
        setNotice('Contents copied. The new folder is active; originals were kept. No restart needed.')
      }
    } catch (cause) {
      reportError('preferences.change-path', cause)
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      locked.current = false
      setBusy(false)
    }
  }

  return <dialog ref={dialog} className={styles.dialog} aria-labelledby={customizing ? 'customize-theme-title' : 'preferences-title'} aria-busy={busy}
    onCancel={(event) => { event.preventDefault(); if (!locked.current) { if (customizing) setCustomizing(false); else onClose() } }}>
    <header className={styles.header}>
      <h2 id="preferences-title">Preferences</h2>
      <button type="button" aria-label="Close preferences" disabled={busy} onClick={onClose}>×</button>
    </header>
    <div className={customizing ? styles.customizingLayout : styles.layout}>
      {!customizing && <nav className={styles.sections} role="tablist" aria-label="Preferences sections" aria-orientation="vertical">
        {SECTION_IDS.map((id, index) => <button key={id} type="button" role="tab" id={`preferences-tab-${id}`}
          aria-controls={`preferences-${id}`} aria-selected={section === id} tabIndex={section === id ? 0 : -1}
          disabled={busy || customizing} onClick={() => setSection(id)}
          onKeyDown={(event) => {
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? SECTION_IDS.length - 1
              : event.key === 'ArrowDown' ? (index + 1) % SECTION_IDS.length
                : event.key === 'ArrowUp' ? (index + SECTION_IDS.length - 1) % SECTION_IDS.length : null
            if (next === null) return
            event.preventDefault()
            setSection(SECTION_IDS[next])
            dialog.current?.querySelector<HTMLButtonElement>(`#preferences-tab-${SECTION_IDS[next]}`)?.focus()
          }}>{SECTIONS[id]}</button>)}
      </nav>}
      <div className={styles.content}>
    <section className={styles.section} role="tabpanel" id="preferences-appearance" aria-labelledby="preferences-tab-appearance" hidden={section !== 'appearance'}>
      {customizing ? <ThemeCustomizer onClose={() => setCustomizing(false)} onBusyChange={(value) => { locked.current = value; setBusy(value) }} /> : <>

      <h3 id="appearance-title">Appearance</h3>
      <div className={styles.theme}>
        <label htmlFor="preferences-theme">Select Theme</label>
        <div className={styles.themeControls}>
        <select id="preferences-theme" aria-label="Select Theme" value={resolveTheme(theme, themes)} disabled={busy}
          onChange={(event) => setTheme(event.target.value)}>
          {themes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <button type="button" disabled={busy} onClick={() => setCustomizing(true)}>Customize Theme</button>
        </div>
      </div>
      {themeErrors.length > 0 && <p className={styles.error} role="alert">{themeErrors.join('\n')}</p>}
      </>}
    </section>
    <section className={styles.section} role="tabpanel" id="preferences-folders" aria-labelledby="preferences-tab-folders" hidden={section !== 'folders'}>
      <h3 id="libraries-title">Content folders</h3>
      <p className={styles.description}>Choose a folder to copy the existing content there and use that location from now on. Originals are kept; existing destination files are never overwritten.</p>
      {!desktop && <p className={styles.description}>Folder preferences are available in the desktop app.</p>}
      {loading && <p role="status">Loading folders…</p>}
      {PATH_FIELDS.map(({ kind, label }) => <label key={kind} className={styles.path}>
        <span>{label}</span>
        <span className={styles.pathControls}>
          <input aria-label={label} value={paths?.[kind] ?? ''} readOnly title={paths?.[kind]} onFocus={(event) => event.target.select()} />
          <button type="button" aria-label={`Edit ${label}`} disabled={!desktop || loading || busy || !paths} onClick={() => void changePath(kind)}>Change…</button>
        </span>
      </label>)}
      <p className={styles.description}>External executable plugins are reserved for stage 2. Changing Plugin Path does not enable them.</p>
      <p className={styles.description}>Errors are recorded as .txt files in Logs Path. Check logs for private information before sharing them.</p>
    </section>
    <section className={styles.section} role="tabpanel" id="preferences-shortcuts" aria-labelledby="preferences-tab-shortcuts" hidden={section !== 'shortcuts'}>
      <h3>Shortcuts</h3>
      <p className={styles.description}>Use Cmd instead of Ctrl for keyboard shortcuts on macOS. Editing shortcuts apply while writing in the document. Hold Ctrl and scroll over a page to zoom in editing or page view. File and zoom shortcuts are paused while a dialog is open.</p>
      <table className={styles.shortcuts}>
        <thead><tr><th scope="col">Action</th><th scope="col">Shortcut</th></tr></thead>
        <tbody>{[
          ...Object.values(FILE_SHORTCUTS).map(({ label, key }) => ({ label, keys: ['Ctrl', key.toUpperCase()] })),
          ...EDITOR_SHORTCUTS,
          ...ZOOM_SHORTCUTS,
        ].map(({ label, keys }) => <tr key={label}><td>{label}</td><td>{keys.map((key, index) => <span key={key}>{index > 0 && <span aria-hidden="true"> + </span>}<kbd>{key}</kbd></span>)}</td></tr>)}</tbody>
      </table>
    </section>
    {busy && !customizing && <p role="status">Selecting a folder or copying content…</p>}
    <section className={styles.section} role="tabpanel" id="preferences-autosave" aria-labelledby="preferences-tab-autosave" hidden={section !== 'autosave'}>
      <AutoSaveSettings />
    </section>
    <section className={styles.section} role="tabpanel" id="preferences-project" aria-labelledby="preferences-tab-project" hidden={section !== 'project'}>
      <h3>Project properties</h3>
      {section === 'project' && <ProjectSettings />}
    </section>
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {!paths && desktop && !loading && <button type="button" onClick={() => { setLoading(true); setError(''); setAttempt((value) => value + 1) }}>Retry loading folders</button>}
      </div>
    </div>
    {!customizing && <footer className={styles.footer}>
      <span>Preferences are saved in setting.json. No restart needed.</span>
      <button type="button" disabled={busy} onClick={onClose}>Done</button>
    </footer>}
  </dialog>
}
