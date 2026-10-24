import { useEffect, useRef, useState } from 'react'
import { changeLibraryPath, loadLibraryPaths, type LibraryKind, type LibraryPaths } from '../../lib/preferences'
import { isTauri } from '../../hooks/useFileSystem'
import { useSettingsStore } from '../../stores/settingsStore'
import { useThemeStore } from '../../stores/themeStore'
import { useTemplateStore } from '../../stores/templateStore'
import { resolveTheme } from '../../lib/themes'
import styles from './PreferencesDialog.module.css'
import { ThemeCustomizer } from './ThemeCustomizer'
import { reportError } from '../../lib/errorLogging'

const PATH_FIELDS: { kind: LibraryKind; label: string }[] = [
  { kind: 'plugins', label: 'Plugin Path' },
  { kind: 'snippets', label: 'Snippet Path' },
  { kind: 'templates', label: 'Template Path' },
  { kind: 'themes', label: 'Theme Path' },
  { kind: 'logs', label: 'Logs Path' },
]

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
    {customizing ? <ThemeCustomizer onClose={() => setCustomizing(false)} onBusyChange={(value) => { locked.current = value; setBusy(value) }} /> : <>
    <header className={styles.header}>
      <h2 id="preferences-title">Preferences</h2>
      <button type="button" aria-label="Close preferences" disabled={busy} onClick={onClose}>×</button>
    </header>
    <section className={styles.section} aria-labelledby="appearance-title">
      <h3 id="appearance-title">Appearance</h3>
      <label className={styles.theme}>Select Theme
        <select aria-label="Select Theme" value={resolveTheme(theme, themes)} disabled={busy}
          onChange={(event) => setTheme(event.target.value)}>
          {themes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      <button type="button" disabled={busy} onClick={() => setCustomizing(true)}>Customize Theme</button>
      {themeErrors.length > 0 && <p className={styles.error} role="alert">{themeErrors.join('\n')}</p>}
    </section>
    <section className={styles.section} aria-labelledby="libraries-title">
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
    {busy && <p role="status">Selecting a folder or copying content…</p>}
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {!paths && desktop && !loading && <button type="button" onClick={() => { setLoading(true); setError(''); setAttempt((value) => value + 1) }}>Retry loading folders</button>}
    <footer className={styles.footer}>
      <span>Preferences are saved in setting.json. No restart needed.</span>
      <button type="button" disabled={busy} onClick={onClose}>Done</button>
    </footer>
    </>}
  </dialog>
}
