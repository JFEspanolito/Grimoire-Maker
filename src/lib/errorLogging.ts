import { invoke, isTauri } from '@tauri-apps/api/core'
import { useSessionStore } from '../stores/sessionStore'
import { useThemeStore } from '../stores/themeStore'
import { useTemplateStore } from '../stores/templateStore'
import { useModStore } from '../stores/modStore'

const MAX_TEXT = 16_384
const DEDUP_MS = 5_000
const recent = new Map<string, number>()
const originalWarn = console.warn.bind(console)
let pending = 0
let warned = false
let dispose: (() => void) | undefined

/** Best-effort redaction, not a guarantee that arbitrary exception text is private. */
function redact(text: string): string {
  return text
    .replace(/\b(Bearer\s+)\S+/gi, '$1[redacted]')
    .replace(/\b(password|passwd|token|api[_-]?key|secret|authorization)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[redacted]@')
    .slice(0, MAX_TEXT)
}

function safeText(value: unknown): string {
  if (value instanceof Error) return value.message
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  return '[non-text error omitted]'
}

const TECHNICAL_ERROR_PATTERNS = [
  /Permissions associated with this command:/i,
  /\bnot allowed\b.*?\bfs:/i,
  /\b(?:fs|dialog|core|tauri):allow-/i,
  /\b(?:TypeError|ReferenceError|SyntaxError|RangeError|URIError):/i,
  /\bat\s+\S+\s+\([^)]+:\d+:\d+\)/,
]

/** Strips raw Tauri ACL dumps, stack traces, and internal runtime details so UI alerts stay human-readable while full details go to Logs Path. */
export function friendlyErrorMessage(error: unknown, fallback = 'Could not complete this action. Try again, or check the error logs in Preferences → Content folders.'): string {
  const raw = safeText(error).trim()
  if (!raw || raw === '[non-text error omitted]') return fallback
  if (TECHNICAL_ERROR_PATTERNS.some((pattern) => pattern.test(raw))) return fallback
  return raw
}

function warnUnavailable(): void {
  if (warned) return
  warned = true
  // Bypass interception and avoid reporting the logging failure back to itself.
  originalWarn('Error logging is unavailable or at capacity. Check Logs Path and available disk space. Existing logs were retained.')
}

/** Report a caught failure without serializing document objects or arbitrary error payloads. */
export function reportError(source: string, error: unknown): void {
  try {
    if (!isTauri()) return
    const key = redact(safeText(error))
    const now = Date.now()
    if (recent.has(key) && now - recent.get(key)! < DEDUP_MS) return
    for (const [previous, time] of recent) if (now - time >= DEDUP_MS) recent.delete(previous)
    if (pending >= 64 || recent.size >= 256) { warnUnavailable(); return }
    recent.set(key, now)
    const message = redact(error instanceof Error ? error.stack || error.message : safeText(error))
    pending++
    try {
      void invoke('append_error_log', { source: redact(source).slice(0, 80), message })
        .catch(warnUnavailable)
        .finally(() => { pending-- })
    } catch {
      pending--
      warnUnavailable()
    }
  } catch {
    // Exotic thrown values/getters must not break the original application error path.
    warnUnavailable()
  }
}

/** Install before React renders. The returned cleanup also supports development hot reload. */
export function installErrorLogging(): () => void {
  if (dispose) return dispose
  const onError = (event: ErrorEvent) => reportError('window.error', event.error ?? event.message)
  const onRejection = (event: PromiseRejectionEvent) => reportError('unhandledrejection', event.reason)
  const originalError = console.error
  const interceptedError: typeof console.error = (...args: unknown[]) => {
    originalError.apply(console, args)
    try {
      reportError('console.error', args.find(arg => arg instanceof Error) ?? args.map(safeText).join(' '))
    } catch {
      warnUnavailable()
    }
  }
  console.error = interceptedError
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  const unsubscribers = [
    useSessionStore.subscribe((state, previous) => {
      if (state.workspaceError && state.workspaceError !== previous.workspaceError) reportError('workspace', state.workspaceError)
    }),
    useThemeStore.subscribe((state, previous) => {
      if (state.errors !== previous.errors) state.errors.forEach(error => reportError('themes', error))
    }),
    useTemplateStore.subscribe((state, previous) => {
      if (state.errors !== previous.errors) state.errors.forEach(error => reportError('templates', error))
    }),
    useModStore.subscribe((state, previous) => {
      if (state.errors !== previous.errors) state.errors.forEach(error => reportError('mods', error))
    }),
  ]
  const workspaceError = useSessionStore.getState().workspaceError
  if (workspaceError) reportError('workspace', workspaceError)
  useThemeStore.getState().errors.forEach(error => reportError('themes', error))
  useTemplateStore.getState().errors.forEach(error => reportError('templates', error))
  useModStore.getState().errors.forEach(error => reportError('mods', error))
  dispose = () => {
    if (console.error === interceptedError) console.error = originalError
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
    unsubscribers.forEach(unsubscribe => unsubscribe())
    recent.clear()
    warned = false
    dispose = undefined
  }
  return dispose
}

if (import.meta.hot) import.meta.hot.dispose(() => dispose?.())
