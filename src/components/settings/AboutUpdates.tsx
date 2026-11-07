import { useEffect, useState } from 'react'
import { checkForAppUpdates, type UpdateInfo } from '../../lib/versionCheck'
import { useTranslation } from '../../lib/i18n'
import styles from './AppInfoDialog.module.css'

// Session-only: no disk writes, storage permission or cross-session dismissal.
const dismissedVersions = new Set<string>()

export function AboutUpdates() {
  const { t } = useTranslation()
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    // One check per opening, including React StrictMode effect replay.
    void Promise.resolve().then(async () => {
      if (!active) return
      try {
        const result = await checkForAppUpdates(controller.signal)
        if (active) {
          setInfo(result)
          setDismissed(!!result && dismissedVersions.has(result.latestVersion))
        }
      } catch {
        if (active) setInfo(null)
      } finally {
        if (active) setLoading(false)
      }
    })
    return () => { active = false; controller.abort() }
  }, [])

  if (dismissed) return null
  return <section aria-labelledby="app-updates-title">
    <h3 id="app-updates-title">{t('about.updates')}</h3>
    <p role="status" className={styles.muted}>{loading ? t('about.checkingUpdates')
      : !info ? t('about.checkUpdatesFailed')
        : info.hasUpdate ? `${t('about.newVersionAvailable')}${info.latestVersion}` : t('about.upToDate')}</p>
    {!loading && !info?.hasUpdate && (
      <button
        type="button"
        style={{ marginTop: '0.4rem', fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
        onClick={() => {
          setLoading(true)
          void checkForAppUpdates().then((res) => {
            setInfo(res)
            setLoading(false)
          }).catch(() => {
            setInfo(null)
            setLoading(false)
          })
        }}
      >
        {t('menu.settings.checkUpdates')}
      </button>
    )}
    {!loading && info?.hasUpdate && <>
      <p className={styles.muted}>{t('about.installedVersion')}{info.currentVersion}</p>
      <a href={info.releaseUrl} target="_blank" rel="noopener noreferrer">{t('about.viewRelease')}</a>
      <button type="button" onClick={() => { dismissedVersions.add(info.latestVersion); setDismissed(true) }}>{t('about.dismiss')}</button>
    </>}
  </section>
}
