import { useRef, useState } from 'react'
import { friendlyErrorMessage, reportError } from '../../lib/errorLogging'

/** Plain "Saved to ..." sentence for whatever an export action reports back (a path, or an object with one). */
export function savedMessage(label: string, result: unknown): string {
  const path = typeof result === 'string' ? result
    : result && typeof result === 'object' && 'path' in result && typeof result.path === 'string' ? result.path : ''
  return path ? `${label} saved to ${path}` : `${label} saved.`
}

/** Busy, status and error state for one tab; failures become plain sentences. */
export function useAction() {
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const locked = useRef(false)
  const run = async (scope: string, fallback: string, operation: () => Promise<string | void>) => {
    if (locked.current) return
    locked.current = true
    setBusy(true)
    setStatus('')
    setError('')
    try {
      const message = await operation()
      if (message) setStatus(message)
    } catch (cause) {
      reportError(scope, cause)
      setError(friendlyErrorMessage(cause, fallback))
    } finally {
      locked.current = false
      setBusy(false)
    }
  }
  return { busy, status, error, setError, run }
}
