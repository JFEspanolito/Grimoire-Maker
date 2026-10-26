import { useState } from 'react'
import { exportTheme } from '../../lib/modExport'
import { useThemeStore } from '../../stores/themeStore'
import { savedMessage, useAction } from './createModShared'
import styles from './CreateMod.module.css'

/** Themes tab: export an installed theme, or jump to the Theme Customizer to design a new one. */
export function CreateModThemes({ onOpenThemeCustomizer }: { onOpenThemeCustomizer: () => void }) {
  const userThemes = useThemeStore((state) => state.userThemes)
  const [selected, setSelected] = useState('')
  const { busy, status, error, run } = useAction()
  const chosen = userThemes.some((theme) => theme.id === selected) ? selected : ''
  return (
    <div className={styles.stack}>
      <label className={styles.field}>
        <span>Installed theme</span>
        <select aria-label="Installed theme" value={chosen} disabled={busy || userThemes.length === 0} onChange={(event) => setSelected(event.target.value)}>
          <option value="">{userThemes.length ? 'Select a theme…' : 'No installed themes yet'}</option>
          {userThemes.map((theme) => <option key={theme.id} value={theme.id}>{theme.name}</option>)}
        </select>
      </label>
      <div className={styles.row}>
        <button type="button" className={styles.primary} disabled={busy || !chosen}
          onClick={() => void run('mods.create.theme-export', 'Could not export the theme.', async () => {
            const result = await exportTheme(chosen)
            return result ? savedMessage('Theme', result) : ''
          })}>Export Selected Theme</button>
      </div>
      <p className={styles.hint}>Saves a .css file, or a .zip when the theme carries its own fonts or images.</p>
      <div className={styles.separator} role="separator"><span>o diseña uno nuevo</span></div>
      <div className={styles.row}>
        <button type="button" disabled={busy} onClick={onOpenThemeCustomizer}>Open Theme Customizer</button>
      </div>
      {busy && <p role="status">Exporting…</p>}
      {status && <p role="status" className={styles.success}>{status}</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </div>
  )
}
