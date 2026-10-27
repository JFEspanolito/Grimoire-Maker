import { useState } from 'react'
import { grantPluginConsent, removeExternalPlugin, type ExternalPluginSummary } from '../../lib/externalPlugins'
import { activateExternalPlugin, stopExternalPluginNow } from '../../plugins/isolated/externalHost'
import { PERMISSIONS, isPermission } from '../../plugins/isolated/permissions'
import { DeleteModButton } from './DeleteModButton'
import { DetailLine, PluginCard } from './PluginCard'
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

/** The plain status word for the first row and, when it is not obvious, the sentence that explains it. */
function describeStatus(plugin: ExternalPluginSummary, running: boolean, switchedOff: boolean): { word: string; why?: string } {
  if (plugin.state === 'altered') {
    return { word: 'Changed', why: 'Files changed after installation. Remove this plugin, then import the package again.' }
  }
  if (switchedOff) return { word: 'Off', why: 'All imported plugins are turned off.' }
  if (!plugin.approved) return { word: 'Needs approval', why: 'Review what it can do, then approve it to turn it on.' }
  if (plugin.state === 'active') return { word: 'On', why: running ? undefined : 'It is on but has not started yet.' }
  if (plugin.state === 'stopped') return { word: 'Stopped', why: 'It stopped because it failed or stopped responding.' }
  return { word: 'Off' }
}

/** An imported ZIP package; folders in the Plugins directory use LocalPluginCard. */
export function ExternalPluginCard({ plugin, running, busy, switchedOff, run, refresh }: Props) {
  const [reviewing, setReviewing] = useState(false)
  const blocked = switchedOff

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

  const status = describeStatus(plugin, running, switchedOff)
  const actions = (
    <>
      {!altered && !plugin.approved && (
        <button type="button" disabled={busy || blocked} aria-label={`Review and approve ${plugin.name}`} onClick={() => setReviewing(true)}>Review…</button>
      )}
      {!altered && plugin.approved && (
        <button type="button" disabled={busy || (blocked && plugin.state !== 'active')} aria-label={`${plugin.state === 'active' ? 'Deactivate' : 'Activate'} external plugin ${plugin.name}`} onClick={() => void toggle()}>
          {plugin.state === 'active' ? 'Turn off' : 'Turn on'}
        </button>
      )}
      {!altered && !plugin.approved && running && (
        <button type="button" disabled={busy} aria-label={`Deactivate external plugin ${plugin.name}`}
          onClick={() => void run(async () => { await stopExternalPluginNow(plugin.id); await refresh() })}>Turn off</button>
      )}
    </>
  )
  const details = (
    <>
      {status.why && <p>{status.why}</p>}
      <DetailLine label="Id">{plugin.id}</DetailLine>
      <DetailLine label="Made by">{plugin.author} (declared by the package, not verified)</DetailLine>
      <DetailLine label="What it can do">
        {plugin.permissions.length === 0 ? 'Nothing special' : (
          <ul>{plugin.permissions.map((permission) => <li key={permission}>{isPermission(permission) ? PERMISSIONS[permission].label : permission}</li>)}</ul>
        )}
      </DetailLine>
      <DetailLine label="Version fingerprint">{plugin.fingerprint.slice(0, 12)}</DetailLine>
      <p>
        <DeleteModButton name={plugin.name} disabled={busy}
          onConfirm={() => run(async () => { await stopExternalPluginNow(plugin.id).catch(() => undefined); await removeExternalPlugin(plugin.id); await refresh() })} />
      </p>
    </>
  )

  return (
    <PluginCard name={plugin.name} version={plugin.version} origin="Imported" status={status.word}
      description={plugin.description} actions={actions} details={details}>
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
    </PluginCard>
  )
}
