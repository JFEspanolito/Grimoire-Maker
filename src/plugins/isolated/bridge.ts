import {
  LIMITS, PROTOCOL_VERSION, parseWorkerMessage,
  type Axis, type ErrorCode, type HostMessage, type ParsedRequest, type Topic,
} from './protocol'
import { permissionFor, permissionForTopic, type Permission } from './permissions'

export interface GuideInfo { id: string; axis: Axis; positionMm: number }
export interface Geometry { pageWidthMm: number; pageHeightMm: number; zoom: number }

/** The only things a plugin can reach. No plugin id, path, document text or generic call exists here. */
export interface HostCapabilities {
  getZoom(): number
  setZoom(value: number): void
  getGeometry(): Geometry
  listGuides(): GuideInfo[]
  addGuide(axis: Axis, positionMm: number): string
  removeGuide(id: string): boolean
}

export interface BridgeHooks {
  /** Events worth keeping in the audit trail. */
  audit(event: 'permission_denied' | 'protocol_violation', detail: string): void
  /** The plugin misbehaved. A fatal fault means the host must stop it now; others are counted. */
  fault(reason: string, fatal: boolean): void
  ready(): void
  pong(n: number): void
}

export interface BridgeOptions {
  granted: readonly Permission[]
  capabilities: HostCapabilities
  send(message: HostMessage): void
  hooks: BridgeHooks
  clock?: () => number
}

export interface Bridge {
  /** Entry point for everything the plugin posts. */
  receive(data: unknown): void
  /** Pushes the current value of a topic to the plugin if it subscribed and may read it. */
  emit(topic: Topic): void
  /** Tells the plugin a declared toolbar control was used. */
  command(command: string, value: string | null): void
  ping(n: number): void
  /** Revokes the channel: pending work is dropped and nothing further is delivered or applied. */
  close(): void
  readonly closed: boolean
}

const error = (code: ErrorCode, message: string) => ({ code, message })

/**
 * One bridge per plugin instance. Identity is the bridge itself (the host created it for exactly
 * one channel); nothing in a message can name another plugin. Every request is checked again for
 * shape, size, rate, permission and liveness before it touches the editor.
 */
export function createBridge(options: BridgeOptions): Bridge {
  const granted = new Set<string>(options.granted)
  const clock = options.clock ?? (() => performance.now())
  const subscriptions = new Set<Topic>()
  let closed = false
  let pending = 0
  let windowStart = clock()
  let inWindow = 0
  let violations = 0

  const send = (message: HostMessage) => { if (!closed) options.send(message) }
  const reject = (id: number | null, code: ErrorCode, message: string) => {
    if (id !== null) send({ v: PROTOCOL_VERSION, kind: 'res', id, ok: false, error: error(code, message) })
  }
  const violation = (detail: string) => {
    violations += 1
    if (violations === 1 || violations % 10 === 0) options.hooks.audit('protocol_violation', detail)
    if (violations >= LIMITS.violations && !closed) {
      options.hooks.fault('too many rejected messages', true)
      close()
    }
  }

  const snapshot = (topic: Topic): unknown => {
    switch (topic) {
      case 'zoom': return { zoom: options.capabilities.getZoom() }
      case 'geometry': return options.capabilities.getGeometry()
      case 'guides': return { guides: options.capabilities.listGuides().slice(0, LIMITS.guides) }
    }
  }

  const execute = (request: ParsedRequest): unknown => {
    const capabilities = options.capabilities
    switch (request.op) {
      case 'zoom.get': return capabilities.getZoom()
      case 'zoom.set': capabilities.setZoom(request.value); return capabilities.getZoom()
      case 'geometry.get': return capabilities.getGeometry()
      case 'guides.list': return capabilities.listGuides().slice(0, LIMITS.guides)
      case 'guides.add':
        if (capabilities.listGuides().length >= LIMITS.guides) throw new Error('Too many guides')
        return capabilities.addGuide(request.axis, request.positionMm)
      case 'guides.remove': return capabilities.removeGuide(request.guideId)
      case 'subscribe': subscriptions.add(request.topic); return snapshot(request.topic)
      case 'unsubscribe': subscriptions.delete(request.topic); return true
    }
  }

  const run = (request: ParsedRequest) => {
    pending += 1
    // Yield once so a close() issued between receipt and execution still wins.
    void Promise.resolve().then(() => {
      try {
        if (closed) return
        const permission = permissionFor(request)
        if (!granted.has(permission)) {
          options.hooks.audit('permission_denied', `${request.op} needs ${permission}`)
          violation(`permission denied: ${request.op}`)
          reject(request.id, 'permission_denied', 'Permission was not granted')
          return
        }
        const result = execute(request)
        send({ v: PROTOCOL_VERSION, kind: 'res', id: request.id, ok: true, result })
      } catch {
        reject(request.id, 'failed', 'The operation could not be completed')
      } finally {
        pending -= 1
      }
    })
  }

  /** A message that is not a bounded JSON string is not worth reading: stop the plugin now. */
  const fatal = (detail: string) => {
    options.hooks.audit('protocol_violation', detail)
    options.hooks.fault(detail, true)
    close()
  }

  const receive = (data: unknown) => {
    if (closed) return
    // Structured clones of large objects are paid on the host thread before any check can run, so
    // the channel carries only short JSON text: one cheap copy, then a bounded parse.
    if (typeof data !== 'string') return fatal('non-text message')
    if (data.length > LIMITS.messageBytes) return fatal('message larger than the limit')
    let decoded: unknown
    try { decoded = JSON.parse(data) } catch { return fatal('message is not valid JSON') }
    const parsed = parseWorkerMessage(decoded)
    if (!parsed.ok) {
      violation(parsed.message)
      reject(parsed.id, parsed.code, parsed.message)
      return
    }
    const message = parsed.message
    const requestId = message.kind === 'request' ? message.request.id : null
    const now = clock()
    if (now - windowStart >= 1000) { windowStart = now; inWindow = 0 }
    inWindow += 1
    if (inWindow > LIMITS.perSecond) {
      violation('rate limit exceeded')
      reject(requestId, 'rate_limited', 'Too many requests')
      return
    }
    if (message.kind === 'pong') return options.hooks.pong(message.n)
    if (message.kind === 'ready') return options.hooks.ready()
    if (message.kind === 'fault') {
      options.hooks.audit('protocol_violation', `plugin fault: ${message.message}`)
      options.hooks.fault('plugin reported an unhandled error', false)
      return
    }
    if (pending >= LIMITS.pending) {
      violation('too many pending requests')
      reject(message.request.id, 'busy', 'Too many pending requests')
      return
    }
    run(message.request)
  }

  const close = () => {
    closed = true
    subscriptions.clear()
  }

  return {
    receive,
    emit(topic) {
      if (closed || !subscriptions.has(topic) || !granted.has(permissionForTopic(topic))) return
      try { send({ v: PROTOCOL_VERSION, kind: 'event', topic, data: snapshot(topic) }) } catch { /* a failing host read must not reach the plugin */ }
    },
    command(command, value) {
      if (!closed) send({ v: PROTOCOL_VERSION, kind: 'command', command, value })
    },
    ping(n) { send({ v: PROTOCOL_VERSION, kind: 'ping', n }) },
    close,
    get closed() { return closed },
  }
}
