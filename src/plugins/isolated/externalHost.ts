import { create } from 'zustand'
import {
  listExternalPlugins, logExternalPluginEvent, readExternalPluginEntry, setExternalPluginActive,
  setExternalPluginsDisabled, stopExternalPlugin,
} from '../../lib/externalPlugins'
import { reportError } from '../../lib/errorLogging'
import { registerPlugin } from '../plugin-manager'
import { hostCapabilities, watchHost } from './capabilities'
import { createExternalToolbar } from './ExternalToolbar'
import { runIsolationProbes, type IsolationReport } from './probes'
import { startPlugin, type PluginInstance, type StopReason } from './runtime'

interface ExternalRuntimeState {
  /** Ids of plugins whose isolated instance is alive right now. */
  running: string[]
  isolation: IsolationReport | null
  checking: boolean
}
export const useExternalRuntime = create<ExternalRuntimeState>(() => ({ running: [], isolation: null, checking: false }))

interface Live { instance: PluginInstance; cleanup: () => void }
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
    if (entry.toolbar.length) {
      const toolbar = createExternalToolbar(entry.toolbar, (command, value) => instance?.command(command, value))
      const dispose = registerPlugin({
        id: `external.${id}`, name: id, version: entry.version,
        activate: (api) => api.registerToolbar({ id: `external.${id}.toolbar`, title: id, component: toolbar }),
      })
      cleanups.push(dispose)
    }
    cleanups.push(watchHost((topic) => instance?.emit(topic)))
    live.set(id, { instance, cleanup: () => cleanups.reverse().forEach((cleanup) => { try { cleanup() } catch (error) { reportError('plugin.external.cleanup', error) } }) })
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
    for (const { instance } of [...live.values()]) instance.stop('killed')
  }
  await setExternalPluginsDisabled(disabled)
}

/** App start: native integrity checks run inside the registry listing and again per plugin read. */
export async function startActiveExternalPlugins(): Promise<void> {
  const registry = await listExternalPlugins()
  if (registry.disabledAll) return
  for (const [id, record] of Object.entries(registry.plugins)) {
    if (record.state !== 'active') continue
    try { await startExternalPlugin(id) } catch (error) { reportError('plugin.external.start', error) }
  }
}
