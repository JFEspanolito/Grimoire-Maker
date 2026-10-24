import { reportError } from '../../lib/errorLogging'
import { useRef, useState } from 'react'
import { packProject, restoreProject } from '../../lib/projectArchive'
import styles from './ProjectArchiveActions.module.css'

interface ProjectArchiveActionsProps {
  workspacePath: string | null
  onRestored: (path: string) => void | Promise<void>
}

/** Archives contain saved project files; unsaved editor changes are not included. */
export function ProjectArchiveActions({ workspacePath, onRestored }: ProjectArchiveActionsProps) {
  const locked = useRef(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const run = async (restore: boolean) => {
    if ((!restore && !workspacePath) || locked.current) return
    locked.current = true
    setBusy(true)
    setMessage('')
    setError('')
    try {
      const path = await (restore ? restoreProject() : packProject())
      if (!path) return
      setMessage(`${restore ? 'Project restored' : 'Archive saved'}: ${path}`)
      if (restore) await onRestored(path)
    } catch (cause) {
      reportError('project.archive', cause)
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      locked.current = false
      setBusy(false)
    }
  }
  return <section className={styles.actions} aria-label="Project archives" aria-busy={busy}>
    <div className={styles.buttons}>
      <button type="button" disabled={!workspacePath || busy} onClick={() => void run(false)}
        title="Pack saved project files into ZIP. Save edits first.">Pack ZIP</button>
      <button type="button" disabled={busy} onClick={() => void run(true)}
        title="Restore ZIP into a new folder without replacing any existing project">Restore ZIP</button>
    </div>
    {busy && <span role="status">Working…</span>}
    {message && <span role="status">{message}</span>}
    {error && <span role="alert" className={styles.error}>{error}</span>}
  </section>
}
