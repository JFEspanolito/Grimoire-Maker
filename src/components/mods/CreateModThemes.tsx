import { useState } from 'react'
import { exportTheme } from '../../lib/modExport'
import { useThemeStore } from '../../stores/themeStore'
import { savedMessage, useAction } from './createModShared'
import { useTranslation } from '../../lib/i18n'
import styles from './CreateMod.module.css'

/** Themes tab: export an installed theme, or jump to the Theme Customizer to design a new one. */
export function CreateModThemes({ onOpenThemeCustomizer }: { onOpenThemeCustomizer: () => void }) {
  const { t } = useTranslation()
  const userThemes = useThemeStore((state) => state.userThemes)
  const [selected, setSelected] = useState('')
  const { busy, status, error, run } = useAction()
  const chosen = userThemes.some((theme) => theme.id === selected) ? selected : ''
  return (
    <div className={styles.stack}>
      <label className={styles.field}>
        <span>{t('createMod.installedTheme')}</span>
        <select aria-label={t('createMod.installedTheme')} value={chosen} disabled={busy || userThemes.length === 0} onChange={(event) => setSelected(event.target.value)}>
          <option value="">{userThemes.length ? t('createMod.selectTheme') : t('createMod.noThemes')}</option>
          {userThemes.map((theme) => <option key={theme.id} value={theme.id}>{theme.name}</option>)}
        </select>
      </label>
      <div className={styles.row}>
        <button type="button" className={styles.primary} disabled={busy || !chosen}
          onClick={() => void run('mods.create.theme-export', 'Could not export the theme.', async () => {
            const result = await exportTheme(chosen)
            return result ? savedMessage('Theme', result) : ''
          })}>{t('createMod.exportTheme')}</button>
      </div>
      <p className={styles.hint}>{t('createMod.themeHint')}</p>
      <div className={styles.separator} role="separator"><span>{t('createMod.orDesignNew')}</span></div>
      <div className={styles.row}>
        <button type="button" disabled={busy} onClick={onOpenThemeCustomizer}>{t('createMod.openCustomizer')}</button>
      </div>
      {busy && <p role="status">{t('createMod.exporting')}</p>}
      {status && <p role="status" className={styles.success}>{status}</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </div>
  )
}
