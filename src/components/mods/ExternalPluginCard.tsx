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
  run(operation: () => Promise<unknown>): Promise<void>
  refresh(): Promise<void>
}

function statusText(plugin: ExternalPluginSummary, running: boolean, switchedOff: boolean): string {
  const mode = 'Unverified · Isolated plugin'
  if (plugin.state === 'altered') return 'Files changed after installation. Remove this plugin, then import the package again.'
  if (switchedOff) return `${mode} · All external plugins are switched off`
  if (!plugin.approved) return `${mode} · Needs your approval`
  if (plugin.state === 'active') return `${mode} · ${running ? 'Running' : 'Active, not running'}`
  if (plugin.state === 'stopped') return `${mode} · Stopped because it failed or stopped responding`
  return `${mode} · Off`
}

export function ExternalPluginCard({ plugin, running, busy, switchedOff, run, refresh }: Props) {
  const [reviewing, setReviewing] = useState(false)

  const approveAndActivate = () => run(async () => {
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
        <small>{plugin.id} · by {plugin.author} (declared, not verified)</small>
        <small>{plugin.description}</small>
        <small>Permissions requested: {plugin.permissions.length ? plugin.permissions.join(', ') : 'none'}</small>
        <small>Fingerprint {plugin.fingerprint.slice(0, 12)}</small>
        <small className={styles.notice}>{statusText(plugin, running, switchedOff)}</small>
      </span>
      {!altered && !plugin.approved && (
        <button type="button" disabled={busy || switchedOff} aria-label={`Review and approve ${plugin.name}`} onClick={() => setReviewing(true)}>Review…</button>
      )}
      {!altered && plugin.approved && (
        <button type="button" disabled={busy || switchedOff} aria-label={`${plugin.state === 'active' ? 'Deactivate' : 'Activate'} external plugin ${plugin.name}`} onClick={() => void toggle()}>
          {plugin.state === 'active' ? 'Deactivate' : 'Activate'}
        </button>
      )}
      <button type="button" disabled={busy} aria-label={`Remove external plugin ${plugin.name}`}
        onClick={() => void run(async () => { await stopExternalPluginNow(plugin.id).catch(() => undefined); await removeExternalPlugin(plugin.id); await refresh() })}>Remove</button>

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
