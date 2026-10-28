import { createBridge, type Bridge, type HostCapabilities } from './bridge'
import { launchIsolated, type Launched } from './frame'
import { isPermission } from './permissions'
import type { Topic } from './protocol'
import { WORKER_BOOTSTRAP } from './workerBootstrap'

export type StopReason = 'deactivated' | 'start-timeout' | 'watchdog' | 'faults' | 'protocol' | 'start-failed' | 'killed'

export interface RuntimeEntry {
  id: string
  version: string
  permissions: string[]
  source: string
}

export interface RuntimeOptions {
  entry: RuntimeEntry
  capabilities: HostCapabilities
  /** Called once when the instance ends for any reason. The host decides what to persist. */
  onStopped(reason: StopReason, detail: string): void
  audit(event: 'permission_denied' | 'protocol_violation', detail: string): void
  startTimeoutMs?: number
  pingIntervalMs?: number
  pingTimeoutMs?: number
  maxFaults?: number
}

export interface PluginInstance {
  readonly id: string
  /** Increases with every instance of the same plugin; late work from an older one is ignored. */
  readonly generation: number
  readonly running: boolean
  emit(topic: Topic): void
  command(command: string, value: string | null): void
  stop(reason?: StopReason): void
}

const generations = new Map<string, number>()

/**
 * Starts one plugin instance in its own isolated frame and supervises it. A plugin that never
 * becomes ready, stops answering the heartbeat, faults repeatedly or floods the bridge is stopped
 * by removing its frame; none of that waits on the plugin's own thread.
 */
export async function startPlugin(options: RuntimeOptions): Promise<PluginInstance> {
  const { entry } = options
  const generation = (generations.get(entry.id) ?? 0) + 1
  generations.set(entry.id, generation)
  const startTimeout = options.startTimeoutMs ?? 5000
  const pingInterval = options.pingIntervalMs ?? 2000
  const pingTimeout = options.pingTimeoutMs ?? 5000
  const maxFaults = options.maxFaults ?? 3

  let launched: Launched | null = null
  let running = true
  let ready = false
  let faults = 0
  let pingNumber = 0
  let awaitingSince: number | null = null
  let startTimer: ReturnType<typeof setTimeout> | undefined
  let heartbeat: ReturnType<typeof setInterval> | undefined

  const stop = (reason: StopReason, detail = '') => {
    if (!running) return
    running = false
    clearTimeout(startTimer)
    clearInterval(heartbeat)
    bridge.close()
    launched?.destroy()
    options.onStopped(reason, detail)
  }

  const bridge: Bridge = createBridge({
    granted: entry.permissions.filter(isPermission),
    capabilities: options.capabilities,
    send: (message) => launched?.post(message),
    hooks: {
      audit: options.audit,
      ready: () => {
        if (ready || !running) return
        ready = true
        clearTimeout(startTimer)
        heartbeat = setInterval(() => {
          const now = performance.now()
          if (awaitingSince !== null && now - awaitingSince > pingTimeout) return stop('watchdog', 'no heartbeat answer')
          if (awaitingSince === null) { awaitingSince = now; bridge.ping(++pingNumber) }
        }, pingInterval)
      },
      pong: (n) => { if (n === pingNumber) awaitingSince = null },
      fault: (reason, fatal) => {
        faults += 1
        if (fatal) stop('protocol', reason)
        else if (faults >= maxFaults) stop('faults', reason)
      },
    },
  })

  startTimer = setTimeout(() => stop('start-timeout', 'the plugin did not become ready'), startTimeout)
  try {
    launched = await launchIsolated({
      bootstrap: WORKER_BOOTSTRAP,
      source: entry.source,
      onMessage: (data) => { if (running) bridge.receive(data) },
      onWorkerError: (message) => stop('start-failed', message),
    })
  } catch (error) {
    stop('start-failed', error instanceof Error ? error.message : 'could not create the frame')
  }
  // stop() may have run while the frame was being created.
  if (!running) launched?.destroy()

  return {
    id: entry.id,
    generation,
    get running() { return running },
    emit: (topic) => { if (running) bridge.emit(topic) },
    command: (command, value) => { if (running) bridge.command(command, value) },
    stop: (reason = 'deactivated') => stop(reason),
  }
}
