import { useEffect, useState } from 'react'
import { checkForAppUpdates, type UpdateInfo } from '../../lib/versionCheck'
import styles from './AppInfoDialog.module.css'

// Session-only: no disk writes, storage permission or cross-session dismissal.
const dismissedVersions = new Set<string>()

export function AboutUpdates() {
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
    <h3 id="app-updates-title">Updates</h3>
    <p role="status" className={styles.muted}>{loading ? 'Checking for updates…'
      : !info ? 'Could not check for updates. '
        : info.hasUpdate ? `New version available: ${info.latestVersion}` : 'Your version is up to date.'}</p>
    {!loading && info?.hasUpdate && <>
      <p className={styles.muted}>Installed version: {info.currentVersion}</p>
      <a href={info.releaseUrl} target="_blank" rel="noopener noreferrer">View release on GitHub</a>
      <button type="button" onClick={() => { dismissedVersions.add(info.latestVersion); setDismissed(true) }}>Dismiss</button>
    </>}
  </section>
}
