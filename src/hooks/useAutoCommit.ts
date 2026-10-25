import { useEffect, useRef } from 'react'
import { useSettingsStore } from '../stores/settingsStore'
import { useDocumentStore } from '../stores/documentStore'
import { autoCommitChanges } from '../lib/versionControl'
import { notifyRepositoryChanged } from '../lib/repositoryEvents'
import { reportError } from '../lib/errorLogging'
import { isTauri } from './useFileSystem'

/** Commit saved project files only; automatic saving remains independent. */
export function useAutoCommit(ready: boolean): void {
  const enabled = useSettingsStore(state => state.autoCommitEnabled)
  const minutes = useSettingsStore(state => state.autoCommitMinutes)
  const message = useSettingsStore(state => state.autoCommitMessage)
  const workspace = useDocumentStore(state => state.workspaceRoot)
  const running = useRef(false)

  useEffect(() => {
    if (!ready || !enabled || !workspace || !isTauri()) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const schedule = () => { timer = setTimeout(() => void tick(), minutes * 60_000) }
    async function tick() {
      if (cancelled) return
      if (running.current) { schedule(); return }
      running.current = true
      try {
        const result = await autoCommitChanges(workspace!, message)
        if (result === 'committed' || result === 'indexUpdated') notifyRepositoryChanged()
      } catch (error) {
        reportError('git.autoCommit', error)
        // A failed commit may have staged files before the failure.
        notifyRepositoryChanged()
      } finally {
        running.current = false
        if (!cancelled) schedule()
      }
    }
    schedule()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [ready, enabled, minutes, message, workspace])
}
