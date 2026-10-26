import { create } from 'zustand'
import {
  listExternalPlugins, logExternalPluginEvent, readExternalPluginEntry, setExternalPluginActive,
  setExternalPluginsDisabled, stopExternalPlugin,
} from '../../lib/externalPlugins'
import { reportError } from '../../lib/errorLogging'
import { folderName, sameFolder, type LocalPackageSync } from '../../lib/localPackages'
import type { ModEntry } from '../../lib/modCatalog'
import { useModStore } from '../../stores/modStore'
import { registerPlugin, usePluginRegistry } from '../plugin-manager'
import { hostCapabilities, watchHost } from './capabilities'
import { registerHostContributions } from './hostContributions'
import { runIsolationProbes, type IsolationReport } from './probes'
import { startPlugin, type PluginInstance, type StopReason } from './runtime'

interface ExternalRuntimeState {
  /** Ids of plugins whose isolated instance is alive right now. */
  running: string[]
  isolation: IsolationReport | null
  checking: boolean
}
export const useExternalRuntime = create<ExternalRuntimeState>(() => ({ running: [], isolation: null, checking: false }))

interface Live { instance: PluginInstance; cleanup: () => void; origin: string; fingerprint: string }
const live = new Map<string, Live>()
/** One token per start attempt; removing it cancels that attempt wherever it is awaiting. */
const starts = new Map<string, symbol>()
let isolationCheck: Promise<IsolationReport> | null = null

const setRunning = () => useExternalRuntime.setState({ running: [...live.keys()] })
const quiet = (operation: Promise<unknown>) => { operation.catch((error) => reportError('plugin.external', error)) }

/**
 * Runs the frontier self-test once per session (or again on request). Until it reports every
 * check blocked, no external plugin may start: what is not demonstrated stays blocked.
 */
export function verifyIsolation(force = false): Promise<IsolationReport> {
  if (!force && isolationCheck) return isolationCheck
  useExternalRuntime.setState({ checking: true })
  isolationCheck = runIsolationProbes()
    .catch((error): IsolationReport => ({
      ok: false, results: [], loop: { responsive: false, maxLagMs: 0, stopMs: 0 },
      summary: `The isolation self-test failed to run: ${error instanceof Error ? error.message : 'unknown error'}`,
    }))
    .then((report) => { useExternalRuntime.setState({ isolation: report, checking: false }); return report })
  return isolationCheck
}

/** Persisted stop reasons: the user turning a plugin off is not a fault, the rest are. */
const USER_STOPS: StopReason[] = ['deactivated', 'killed']

function finished(id: string, reason: StopReason, detail: string) {
  const entry = live.get(id)
  live.delete(id)
  entry?.cleanup()
  setRunning()
  if (USER_STOPS.includes(reason)) return
  const text = `${reason}${detail ? `: ${detail}` : ''}`
  quiet(stopExternalPlugin(id, text))
  quiet(logExternalPluginEvent(id, reason === 'protocol' ? 'protocol_violation' : 'terminated_by_host', text))
}

/** Starts an already active plugin: re-verifies the files natively, then runs it isolated. */
export async function startExternalPlugin(id: string): Promise<void> {
  if (live.has(id) || starts.has(id)) return
  const token = Symbol(id)
  starts.set(id, token)
  const cancelled = () => starts.get(id) !== token
  try {
    const report = await verifyIsolation()
    if (cancelled()) return
    if (!report.ok) {
      quiet(logExternalPluginEvent(id, 'isolation_failed', report.summary))
      throw new Error(report.summary)
    }
    const entry = await readExternalPluginEntry(id)
    if (cancelled()) return
    // Defensive: package folders are never loaded as trusted code, but a trusted plugin with this id must never run beside it.
    if (usePluginRegistry.getState().plugins.some((plugin) => plugin.id === id)) {
      throw new Error('A trusted plugin with this id is already loaded')
    }
    let instance: PluginInstance | null = null
    const early: { stop: { reason: StopReason; detail: string } | null } = { stop: null }
    instance = await startPlugin({
      entry: { id: entry.id, version: entry.version, permissions: entry.permissions, source: entry.source },
      capabilities: hostCapabilities(),
      audit: (event, detail) => quiet(logExternalPluginEvent(id, event, detail)),
      onStopped: (reason, detail) => {
        // Only the instance that owns the slot may change shared state; a replaced one is ignored.
        if (instance && live.get(id)?.instance === instance) finished(id, reason, detail)
        else if (!instance) early.stop = { reason, detail }
      },
    })
    if (cancelled()) { instance.stop('deactivated'); return }
    if (early.stop) {
      const { reason, detail } = early.stop
      finished(id, reason, detail)
      throw new Error(`The plugin could not start (${reason})`)
    }
    const cleanups: Array<() => void> = []
    const declares = [entry.toolbar, entry.behaviors, entry.overlays, entry.tools].some((list) => list?.length)
    if (declares) {
      const send = (command: string, value: string | null) => instance?.command(command, value)
      cleanups.push(registerPlugin({
        id: `external.${id}`, name: id, version: entry.version,
        activate: (api) => registerHostContributions(api, entry, send),
      }))
    }
    cleanups.push(watchHost((topic) => instance?.emit(topic)))
    live.set(id, { instance, origin: entry.origin, fingerprint: entry.fingerprint, cleanup: () => cleanups.reverse().forEach((cleanup) => { try { cleanup() } catch (error) { reportError('plugin.external.cleanup', error) } }) })
    setRunning()
  } finally {
    if (starts.get(id) === token) starts.delete(id)
  }
}

/** Revokes the channel first, then records the state. */
export async function stopExternalPluginNow(id: string): Promise<void> {
  starts.delete(id)
  live.get(id)?.instance.stop('deactivated')
  await setExternalPluginActive(id, false)
}

export async function activateExternalPlugin(id: string): Promise<void> {
  await setExternalPluginActive(id, true)
  try {
    await startExternalPlugin(id)
  } catch (error) {
    await setExternalPluginActive(id, false).catch(() => undefined)
    throw error
  }
}

export async function setExternalKillSwitch(disabled: boolean): Promise<void> {
  if (disabled) {
    starts.clear()
    for (const { instance, origin } of [...live.values()]) if (origin === 'import') instance.stop('killed')
  }
  await setExternalPluginsDisabled(disabled)
  // Clearing the pending starts above may have cancelled a local plugin that the switch spares.
  if (disabled) await startActiveExternalPlugins().catch((error) => reportError('plugin.external.start', error))
}

const sourceOf = (record: { current: string | null; latest: string; versions: { dir: string; source: string; localFolder?: string }[] }) =>
  record.versions.find((version) => version.dir === record.current) ?? record.versions.find((version) => version.dir === record.latest)

/** Drops a live instance now, without waiting for its stop notification. */
function dropLive(id: string, reason: StopReason) {
  const entry = live.get(id)
  starts.delete(id)
  if (!entry) return
  live.delete(id)
  entry.instance.stop(reason)
  entry.cleanup()
  setRunning()
}

/**
 * Brings the isolated runtime in line with the Plugins folders after a scan: an enabled folder is
 * activated and started, a disabled one stopped, and a running one whose bytes changed restarted.
 * Local packages are not affected by the emergency switch, which only governs imported packages.
 */
export async function applyLocalPackages(mods: ModEntry[], sync: LocalPackageSync): Promise<void> {
  const registry = await listExternalPlugins()
  for (const mod of mods) {
    if (!mod.package) continue
    const folder = folderName(mod.folder)
    const info = sync.packages.find((item) => sameFolder(item.folder, folder))
    if (!info) {
      // The folder no longer validates: whatever ran from it must not keep running.
      for (const [id, record] of Object.entries(registry.plugins)) {
        const version = sourceOf(record)
        if (version?.source === 'local' && version.localFolder && sameFolder(version.localFolder, folder)) dropLive(id, 'deactivated')
      }
      continue
    }
    const id = info.id
    const state = registry.plugins[id]?.state
    try {
      if (!mod.enabled) {
        dropLive(id, 'deactivated')
        if (state === 'active' || state === 'stopped') await setExternalPluginActive(id, false)
        continue
      }
      if (state === 'altered') continue
      // A plugin that stopped itself stays stopped until its files change or the user switches it off and on.
      if (state === 'stopped' && !info.changed) { dropLive(id, 'deactivated'); continue }
      if (state !== 'active') await setExternalPluginActive(id, true)
      const running = live.get(id)
      if (running && running.fingerprint !== info.fingerprint) dropLive(id, 'deactivated')
      await startExternalPlugin(id)
    } catch (error) {
      reportError('plugin.external.local', error)
    }
  }
}

/** App start: native integrity checks run inside the registry listing and again per plugin read. */
export async function startActiveExternalPlugins(): Promise<void> {
  // Trusted plugins are reconciled first, so every plugin has exactly one implementation running.
  const mods = useModStore.getState()
  if (!mods.ready) await mods.reload().catch((error) => reportError('plugin.external.mods', error))
  const registry = await listExternalPlugins()
  for (const [id, record] of Object.entries(registry.plugins)) {
    if (record.state !== 'active') continue
    const version = sourceOf(record)
    if (version?.source === 'local') {
      // A local plugin runs only while its folder is present and switched on in the Mod Manager.
      const folder = version.localFolder
      const mod = folder ? useModStore.getState().mods.find((item) => item.package && sameFolder(folderName(item.folder), folder)) : undefined
      if (!mod?.enabled) continue
    } else if (registry.disabledAll) continue
    try { await startExternalPlugin(id) } catch (error) { reportError('plugin.external.start', error) }
  }
}
