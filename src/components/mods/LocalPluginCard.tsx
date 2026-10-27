import { MOD_KIND, modKey, type ModEntry } from '../../lib/modCatalog'
import { OFFICIAL_PLUGINS } from '../../lib/modLibrary'
import type { ExternalPluginSummary } from '../../lib/externalPlugins'
import { PERMISSIONS, isPermission } from '../../plugins/isolated/permissions'
import { stopExternalPluginNow } from '../../plugins/isolated/externalHost'
import { DeleteModButton } from './DeleteModButton'
import { DetailLine, PluginCard } from './PluginCard'

interface Props {
  mod: ModEntry
  busy: boolean
  /** The registry record of a package folder, when the native sync has recorded it. */
  record?: ExternalPluginSummary
  setEnabled(id: string, enabled: boolean): Promise<void>
  /** Permanently removes the folder, then rescans. */
  deleteMod(id: string): Promise<void>
  run(operation: () => Promise<unknown>): Promise<void>
}

const FALLBACK_DESCRIPTION = 'Plugin from your Plugins folder.'

/** The plain status word and, when it is not obvious, the sentence that explains it. */
function packageStatus(mod: ModEntry, record?: ExternalPluginSummary): { word: string; why?: string } {
  if (mod.errors.length) return { word: 'Error', why: 'This folder could not be used. The problem is listed below.' }
  if (!mod.enabled) return { word: 'Off' }
  if (record?.state === 'stopped') return { word: 'Stopped', why: 'It stopped because it failed or stopped responding. Turn it off and on to try again.' }
  if (record?.state === 'altered') return { word: 'Error', why: 'Its files changed while it was running. Refresh the list.' }
  return { word: 'On' }
}

/** A plugin from the Plugins directory: a package folder (runs isolated) or a TSX folder (trusted). */
export function LocalPluginCard({ mod, busy, record, setEnabled, deleteMod, run }: Props) {
  const official = OFFICIAL_PLUGINS.find((plugin) => modKey(MOD_KIND.PLUGINS, plugin.folder) === mod.id)
  const isPackage = Boolean(mod.package)
  const status = isPackage ? packageStatus(mod, record) : { word: mod.enabled ? 'On' : 'Off' }
  const permissions = record?.permissions ?? []
  const name = record?.name ?? official?.label ?? mod.label
  return (
    <PluginCard name={name} version={record?.version}
      origin={isPackage ? 'Local package' : official ? 'Built in' : 'Local'} status={status.word}
      description={record?.description || official?.description || FALLBACK_DESCRIPTION}
      actions={(
        <button type="button" disabled={busy} aria-label={`Enable ${mod.label}`} aria-pressed={mod.enabled}
          onClick={() => void run(() => setEnabled(mod.id, !mod.enabled))}>{mod.enabled ? 'Turn off' : 'Turn on'}</button>
      )}
      details={(
        <>
          {status.why && <p>{status.why}</p>}
          <DetailLine label="Folder">{mod.folder}</DetailLine>
          {isPackage ? (
            <DetailLine label="What it can do">
              {permissions.length === 0 ? 'Nothing special' : (
                <ul>{permissions.map((permission) => <li key={permission}>{isPermission(permission) ? PERMISSIONS[permission].label : permission}</li>)}</ul>
              )}
            </DetailLine>
          ) : <p>Runs with the same access as the app. Only keep plugins you trust.</p>}
          {mod.errors.length > 0 && <ul aria-label="Plugin problems">{mod.errors.map((error, index) => <li key={`${index}:${error}`}>{error}</li>)}</ul>}
          <p>
            <DeleteModButton name={name} disabled={busy} onConfirm={() => run(async () => {
              // Stop a running isolated plugin first; the rescan after the delete then unloads whatever is left.
              if (record) await stopExternalPluginNow(record.id).catch(() => undefined)
              await deleteMod(mod.id)
            })} />
          </p>
        </>
      )} />
  )
}
