/**
 * Wire protocol between the host and one isolated plugin. Everything a plugin sends is untrusted:
 * the parser accepts only the closed set of shapes below and never reads an identity from it.
 */
export const PROTOCOL_VERSION = 1

export const LIMITS = {
  /** Serialized size of any single message from a plugin. */
  messageBytes: 64 * 1024,
  /** Requests accepted but not yet answered. */
  pending: 16,
  /** Requests per rolling second. */
  perSecond: 60,
  /** Rejected messages tolerated before the plugin is stopped. */
  violations: 50,
  guides: 64,
  textLength: 200,
  idLength: 64,
} as const

export const ZOOM_RANGE = { min: 0.25, max: 3 } as const
export const GUIDE_RANGE_MM = { min: 0, max: 1000 } as const

export const TOPICS = ['zoom', 'geometry', 'guides'] as const
export type Topic = (typeof TOPICS)[number]
export const AXES = ['row', 'column'] as const
export type Axis = (typeof AXES)[number]

export type ErrorCode =
  | 'invalid_message' | 'unknown_operation' | 'invalid_arguments' | 'too_large'
  | 'permission_denied' | 'busy' | 'rate_limited' | 'failed'

export type ParsedRequest =
  | { id: number; op: 'zoom.get' }
  | { id: number; op: 'zoom.set'; value: number }
  | { id: number; op: 'geometry.get' }
  | { id: number; op: 'guides.list' }
  | { id: number; op: 'guides.add'; axis: Axis; positionMm: number }
  | { id: number; op: 'guides.remove'; guideId: string }
  | { id: number; op: 'subscribe' | 'unsubscribe'; topic: Topic }

export type WorkerMessage =
  | { kind: 'request'; request: ParsedRequest }
  | { kind: 'pong'; n: number }
  | { kind: 'ready' }
  | { kind: 'fault'; message: string }

export type ParseResult =
  | { ok: true; message: WorkerMessage }
  | { ok: false; id: number | null; code: ErrorCode; message: string }

export type HostMessage =
  | { v: 1; kind: 'res'; id: number; ok: true; result: unknown }
  | { v: 1; kind: 'res'; id: number; ok: false; error: { code: ErrorCode; message: string } }
  | { v: 1; kind: 'event'; topic: Topic; data: unknown }
  | { v: 1; kind: 'command'; command: string; value: string | null }
  | { v: 1; kind: 'ping'; n: number }

type Fields = Record<string, unknown>

/** A plain object with only the allowed keys; walking stops as soon as the key budget is exceeded. */
function closedObject(value: unknown, allowed: readonly string[]): Fields | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return null
  let seen = 0
  for (const key in value) {
    if (!Object.hasOwn(value, key) || !allowed.includes(key) || ++seen > allowed.length) return null
  }
  return value as Fields
}

const isInteger = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max

const isNumberIn = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max

const isBoundedText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max

function fail(id: number | null, code: ErrorCode, message: string): ParseResult {
  return { ok: false, id, code, message }
}

/** Best effort: only a sane integer id lets the host answer an invalid request. */
function recoverId(data: unknown): number | null {
  if (typeof data !== 'object' || data === null) return null
  const id = (data as Fields).id
  return isInteger(id, 1, 2 ** 31 - 1) ? id : null
}

function parseArguments(id: number, op: string, raw: unknown): ParseResult {
  const bad = (): ParseResult => fail(id, 'invalid_arguments', `Invalid arguments for ${op}`)
  const request = (parsed: ParsedRequest): ParseResult => ({ ok: true, message: { kind: 'request', request: parsed } })
  switch (op) {
    case 'zoom.get': case 'geometry.get': case 'guides.list':
      return closedObject(raw, []) ? request({ id, op } as ParsedRequest) : bad()
    case 'zoom.set': {
      const args = closedObject(raw, ['value'])
      return args && isNumberIn(args.value, ZOOM_RANGE.min, ZOOM_RANGE.max) ? request({ id, op, value: args.value }) : bad()
    }
    case 'guides.add': {
      const args = closedObject(raw, ['axis', 'positionMm'])
      if (!args || !AXES.includes(args.axis as Axis) || !isNumberIn(args.positionMm, GUIDE_RANGE_MM.min, GUIDE_RANGE_MM.max)) return bad()
      return request({ id, op, axis: args.axis as Axis, positionMm: args.positionMm })
    }
    case 'guides.remove': {
      const args = closedObject(raw, ['guideId'])
      return args && isBoundedText(args.guideId, LIMITS.idLength) ? request({ id, op, guideId: args.guideId }) : bad()
    }
    case 'subscribe': case 'unsubscribe': {
      const args = closedObject(raw, ['topic'])
      return args && TOPICS.includes(args.topic as Topic) ? request({ id, op, topic: args.topic as Topic }) : bad()
    }
    default:
      return fail(id, 'unknown_operation', 'Unknown operation')
  }
}

/** Validates one message received from a plugin. Never throws. */
export function parseWorkerMessage(data: unknown): ParseResult {
  try {
    const envelope = closedObject(data, ['v', 'kind', 'id', 'op', 'args', 'n', 'message'])
    if (!envelope || envelope.v !== PROTOCOL_VERSION) return fail(null, 'invalid_message', 'Malformed message')
    switch (envelope.kind) {
      case 'req': {
        const id = recoverId(envelope)
        if (id === null || 'n' in envelope || 'message' in envelope) return fail(null, 'invalid_message', 'Malformed request')
        if (typeof envelope.op !== 'string' || envelope.op.length > 32) return fail(id, 'invalid_message', 'Malformed request')
        return parseArguments(id, envelope.op, 'args' in envelope ? envelope.args : {})
      }
      case 'pong':
        return isInteger(envelope.n, 0, 2 ** 31 - 1) && Object.keys(envelope).length === 3
          ? { ok: true, message: { kind: 'pong', n: envelope.n } } : fail(null, 'invalid_message', 'Malformed pong')
      case 'ready':
        return Object.keys(envelope).length === 2 ? { ok: true, message: { kind: 'ready' } } : fail(null, 'invalid_message', 'Malformed ready')
      case 'fault':
        if (typeof envelope.message === 'string' && envelope.message.length > LIMITS.messageBytes) return fail(null, 'too_large', 'Fault text is too large')
        return typeof envelope.message === 'string' && Object.keys(envelope).length === 3
          ? { ok: true, message: { kind: 'fault', message: envelope.message.slice(0, LIMITS.textLength) } }
          : fail(null, 'invalid_message', 'Malformed fault')
      default:
        return fail(null, 'invalid_message', 'Unknown message kind')
    }
  } catch {
    return fail(null, 'invalid_message', 'Malformed message')
  }
}

/** Serialized size, measured only after the shape has proven small. */
export function messageSize(data: unknown): number {
  try { return JSON.stringify(data)?.length ?? 0 } catch { return Infinity }
}
