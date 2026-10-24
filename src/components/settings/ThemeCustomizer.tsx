import { reportError } from '../../lib/errorLogging'
import { useEffect, useRef, useState } from 'react'
import { isTauri } from '../../hooks/useFileSystem'
import { useSettingsStore } from '../../stores/settingsStore'
import { useThemeStore } from '../../stores/themeStore'
import { resolveTheme } from '../../lib/themes'
import { buildThemeCss, COLOR_FIELDS, loadThemeDraft, saveThemeDraft, themeColors, type ThemeColors, type ThemeDraft } from '../../lib/themeEditor'
import styles from './ThemeCustomizer.module.css'

interface ThemeCustomizerProps { onClose: () => void; onBusyChange?: (busy: boolean) => void }

function preview(draft: ThemeDraft, colors: ThemeColors): string {
  const css = buildThemeCss(draft.css, draft.theme.id, 'sample', 'Sample', colors).replaceAll('<', '\\3c ')
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:"><style>
body { margin: 0; } article { padding: 24px; background: var(--page-bg); color: var(--page-fg); font: 16px/1.5 var(--page-font, Georgia, serif); }
h1,h2,h3 { font-family: var(--heading-font, Georgia, serif); line-height: 1.2; } hr { border: 0; border-top: 2px solid; }
.statblock { padding: 12px; background: var(--statblock-bg); } .readaloud { padding: 12px; background: var(--readaloud-bg); border-left: 3px solid var(--accent); }
${css}</style></head><body><article data-theme="sample"><div class="grimoire-content"><h1>Chapter One</h1><p>A new adventure begins. This sample stays separate from your document.</p><h2>The ancient library</h2><h3>A hidden passage</h3><hr><p class="readaloud">A quiet voice echoes through the hall.</p><div class="statblock"><strong>Library guardian</strong><p>Armor 12 · Health 24</p></div></div></article></body></html>`
}

/** Embedded in Preferences; the host owns its only modal and Escape handling. */
export function ThemeCustomizer({ onClose, onBusyChange }: ThemeCustomizerProps) {
  const { themes, userThemes } = useThemeStore()
  const [themeId] = useState(() => resolveTheme(useSettingsStore.getState().theme, themes))
  const [draft, setDraft] = useState<ThemeDraft | null>(null)
  const [colors, setColors] = useState(() => themeColors(''))
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const locked = useRef(false)
  const busyCallback = useRef(onBusyChange)
  busyCallback.current = onBusyChange
  useEffect(() => {
    let cancelled = false
    const selected = themes.find((theme) => theme.id === themeId)
    if (!isTauri()) { setError('Custom themes can be saved in the desktop app.'); return }
    if (!selected) { setError('The selected theme is no longer available.'); return }
    void loadThemeDraft(selected, userThemes.some((theme) => theme.id === selected.id)).then((value) => {
      if (cancelled) return
      setDraft(value)
      setColors(themeColors(value.css))
      setName(value.path ? selected.name : `${selected.name} Copy`)
    }, (cause: unknown) => { if (!cancelled) { reportError('theme.customize.load', cause); setError(cause instanceof Error ? cause.message : String(cause)) } })
    return () => { cancelled = true }
    // Capture the selected source once; catalog reload is part of the explicit Save transaction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const save = async (copy: boolean) => {
    if (!draft || locked.current) return
    locked.current = true
    setBusy(true)
    busyCallback.current?.(true)
    setError('')
    try {
      const saved = await saveThemeDraft(draft, name, colors, copy, themes.map((theme) => theme.id))
      await useThemeStore.getState().reload()
      const refreshed = useThemeStore.getState()
      if (!refreshed.userThemes.some((theme) => theme.id === saved.id) || refreshed.errors.length) {
        throw new Error(`Theme saved, but could not be reloaded. ${refreshed.errors.join('; ')} Reopen Preferences after resolving the folder errors.`)
      }
      useSettingsStore.getState().setTheme(saved.id)
      onClose()
    } catch (cause) {
      reportError('theme.customize.save', cause)
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      locked.current = false
      setBusy(false)
      busyCallback.current?.(false)
    }
  }

  return <section className={styles.customizer} aria-labelledby="customize-theme-title" aria-busy={busy}>
    <header className={styles.header}><h2 id="customize-theme-title">Customize Theme</h2><button type="button" disabled={busy} onClick={onClose}>Back</button></header>
    <p className={styles.description}>{draft?.path ? 'Save updates this user theme. Save As creates a separate copy.' : 'Built-in and template themes are kept intact. Save creates a named copy.'} Divider color applies throughout the theme.</p>
    {draft && <>
      <label className={styles.name}>Theme name<input aria-label="Theme name" maxLength={80} value={name} disabled={busy} onChange={(event) => setName(event.target.value)} /></label>
      <div className={styles.workspace}>
        <div className={styles.colors}>{(Object.entries(COLOR_FIELDS) as [keyof ThemeColors, string][]).map(([key, label]) => <label key={key}>{label}<input aria-label={label} type="color" value={colors[key]} disabled={busy} onChange={(event) => setColors((current) => ({ ...current, [key]: event.target.value }))} /></label>)}</div>
        <iframe title="Theme preview" sandbox="" className={styles.preview} srcDoc={preview(draft, colors)} />
      </div>
      <p className={styles.description}>Preview only: your document changes after Save. Custom CSS colors outside six-digit hex values use picker defaults; original fonts and layout rules are retained.</p>
    </>}
    {!draft && !error && <p role="status">Loading theme…</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {busy && <p role="status">Saving theme…</p>}
    <footer className={styles.footer}>
      <button type="button" disabled={busy} onClick={onClose}>Cancel</button>
      {draft?.path && <button type="button" disabled={busy} onClick={() => void save(true)}>Save As</button>}
      <button type="button" data-action="save" disabled={!draft || busy} onClick={() => void save(!draft?.path)}>{draft?.path ? 'Save' : 'Save New Theme'}</button>
    </footer>
  </section>
}
