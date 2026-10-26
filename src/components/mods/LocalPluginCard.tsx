import { MOD_KIND, modKey, type ModEntry } from '../../lib/modCatalog'
import { BASELINE_PLUGINS } from '../../lib/modLibrary'
import { DetailLine, PluginCard } from './PluginCard'

interface Props {
  mod: ModEntry
  busy: boolean
  setEnabled(id: string, enabled: boolean): Promise<void>
  run(operation: () => Promise<unknown>): Promise<void>
}

const FALLBACK_DESCRIPTION = 'Plugin from your Plugins folder.'

/** A folder plugin from the Plugins directory, drawn with the same card as the packaged ones. */
export function LocalPluginCard({ mod, busy, setEnabled, run }: Props) {
  const official = BASELINE_PLUGINS.find((plugin) => modKey(MOD_KIND.PLUGINS, plugin.folder) === mod.id)
  return (
    <PluginCard name={official?.label ?? mod.label} origin={official ? 'Built in' : 'Local'} status={mod.enabled ? 'On' : 'Off'}
      description={official?.description ?? FALLBACK_DESCRIPTION}
      actions={(
        <button type="button" disabled={busy} aria-label={`Enable ${mod.label}`} aria-pressed={mod.enabled}
          onClick={() => void run(() => setEnabled(mod.id, !mod.enabled))}>{mod.enabled ? 'Turn off' : 'Turn on'}</button>
      )}
      details={(
        <>
          <DetailLine label="Folder">{mod.folder}</DetailLine>
          <p>Runs with the same access as the app. Only keep plugins you trust.</p>
          {mod.errors.length > 0 && <ul aria-label="Plugin problems">{mod.errors.map((error, index) => <li key={`${index}:${error}`}>{error}</li>)}</ul>}
        </>
      )} />
  )
}
