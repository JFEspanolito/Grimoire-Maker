import { useState } from 'react'
import { grantPluginConsent, removeExternalPlugin, type ExternalPluginSummary } from '../../lib/externalPlugins'
import { activateExternalPlugin, stopExternalPluginNow } from '../../plugins/isolated/externalHost'
import { PERMISSIONS, isPermission } from '../../plugins/isolated/permissions'
import styles from './ModManager.module.css'

interface Props {
  plugin: ExternalPluginSummary
  running: boolean
  busy: boolean
  /** The global emergency switch is on. */
  switchedOff: boolean
  /** An edited local copy of the same plugin is running instead of this bundled one. */
  localCopyInUse: boolean
  /** An untouched older trusted copy that this bundled plugin replaced; its files are kept, not loaded. */
  keptFolder?: string
  run(operation: () => Promise<unknown>): Promise<void>
  refresh(): Promise<void>
}

function statusText(plugin: ExternalPluginSummary, running: boolean, switchedOff: boolean, localCopyInUse: boolean): string {
  const bundled = plugin.source === 'bundled'
  const mode = bundled ? 'Bundled with the app · Isolated plugin' : 'Unverified · Isolated plugin'
  if (bundled && localCopyInUse) return `${mode} · Off: your edited local copy is in use instead`
  if (plugin.state === 'altered') {
    return bundled
      ? 'Its files changed on disk. The application restores them the next time it starts.'
      : 'Files changed after installation. Remove this plugin, then import the package again.'
  }
  if (switchedOff && !bundled) return `${mode} · All external plugins are switched off`
  if (!plugin.approved) return `${mode} · Needs your approval`
  if (plugin.state === 'active') return `${mode} · ${running ? 'Running' : 'Active, not running'}`
  if (plugin.state === 'stopped') return `${mode} · Stopped because it failed or stopped responding`
  return `${mode} · Off`
}

export function ExternalPluginCard({ plugin, running, busy, switchedOff, localCopyInUse, keptFolder, run, refresh }: Props) {
  const [reviewing, setReviewing] = useState(false)
  const bundled = plugin.source === 'bundled'
  const blocked = (switchedOff && !bundled) || (bundled && localCopyInUse)

  const approveAndActivate = () => run(async () => {
    // Approving an update stops the version that is still running, so the new one can start.
    if (running) await stopExternalPluginNow(plugin.id)
    await grantPluginConsent(plugin)
    setReviewing(false)
    await refresh()
    await activateExternalPlugin(plugin.id)
    await refresh()
  })
  const toggle = () => run(async () => {
    if (plugin.state === 'active') await stopExternalPluginNow(plugin.id)
    else await activateExternalPlugin(plugin.id)
    await refresh()
  })
  const altered = plugin.state === 'altered'

  return (
    <div className={styles.row}>
      <span>
        <strong>{plugin.name} <small>v{plugin.version}</small></strong>
        <small>{plugin.id} · by {plugin.author}{bundled ? '' : ' (declared, not verified)'}</small>
        <small>{plugin.description}</small>
        <small>Permissions requested: {plugin.permissions.length ? plugin.permissions.join(', ') : 'none'}</small>
        <small>Fingerprint {plugin.fingerprint.slice(0, 12)}</small>
        <small className={styles.notice}>{statusText(plugin, running, switchedOff, localCopyInUse)}</small>
        {keptFolder && <small>Your older copy in {keptFolder.split('/').slice(-2).join('/')} is kept on disk but not loaded. Edit it to use your version instead.</small>}
      </span>
      {!altered && !plugin.approved && (
        <button type="button" disabled={busy || blocked} aria-label={`Review and approve ${plugin.name}`} onClick={() => setReviewing(true)}>Review…</button>
      )}
      {!altered && plugin.approved && (
        <button type="button" disabled={busy || (blocked && plugin.state !== 'active')} aria-label={`${plugin.state === 'active' ? 'Deactivate' : 'Activate'} external plugin ${plugin.name}`} onClick={() => void toggle()}>
          {plugin.state === 'active' ? 'Deactivate' : 'Activate'}
        </button>
      )}
      {!altered && !plugin.approved && running && (
        <button type="button" disabled={busy} aria-label={`Deactivate external plugin ${plugin.name}`}
          onClick={() => void run(async () => { await stopExternalPluginNow(plugin.id); await refresh() })}>Deactivate</button>
      )}
      {!bundled && (
        <button type="button" disabled={busy} aria-label={`Remove external plugin ${plugin.name}`}
          onClick={() => void run(async () => { await stopExternalPluginNow(plugin.id).catch(() => undefined); await removeExternalPlugin(plugin.id); await refresh() })}>Remove</button>
      )}

      {reviewing && (
        <div className={styles.modalBackdrop} role="dialog" aria-modal="true" aria-labelledby={`consent-${plugin.id}`}>
          <div className={styles.modalCard}>
            <header className={styles.modalHeader}>
              <h3 id={`consent-${plugin.id}`}>Approve {plugin.name}?</h3>
              <button type="button" onClick={() => setReviewing(false)} aria-label="Close approval">×</button>
            </header>
            <p>{plugin.name} v{plugin.version}, by {plugin.author} (declared by the package, not verified).</p>
            <p className={styles.notice}>Unverified. It runs isolated and can only do what is listed below. It cannot read your text, files or network.</p>
            {plugin.permissions.length === 0 ? <p>This plugin asks for no permissions.</p> : (
              <ul aria-label="Permissions requested">
                {plugin.permissions.map((permission) => (
                  <li key={permission}>
                    <strong>{isPermission(permission) ? PERMISSIONS[permission].label : permission}</strong>
                    {isPermission(permission) && <small> {PERMISSIONS[permission].description}</small>}
                  </li>
                ))}
              </ul>
            )}
            <p><small>Fingerprint {plugin.fingerprint.slice(0, 12)}. Any change to the package asks for approval again.</small></p>
            <footer className={styles.modalActions}>
              <button type="button" onClick={() => setReviewing(false)}>Cancel</button>
              <button type="button" disabled={busy} onClick={() => void approveAndActivate()}>Approve and activate</button>
            </footer>
          </div>
        </div>
      )}
    </div>
  )
}
