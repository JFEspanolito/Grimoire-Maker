import { useEffect, useState } from 'react'
import { getRepositoryStatus, type RepositoryStatus } from '../lib/versionControl'
import { REPOSITORY_CHANGED } from '../lib/repositoryEvents'
import { isTauri } from './useFileSystem'

interface Snapshot { workspace: string | null; status: RepositoryStatus | null; error: string }

/** Stays mounted while Source control is collapsed; never stages or commits. */
export function useRepositoryStatus(workspace: string | null) {
  const [snapshot, setSnapshot] = useState<Snapshot>({ workspace: null, status: null, error: '' })
  useEffect(() => {
    if (!workspace || !isTauri()) return
    let cancelled = false
    let pending = false
    let revision = 0
    const refresh = async () => {
      revision++
      if (pending) return
      pending = true
      const current = revision
      try {
        const status = await getRepositoryStatus(workspace)
        if (!cancelled && current === revision) setSnapshot({ workspace, status, error: '' })
      } catch (error) {
        if (!cancelled && current === revision) setSnapshot(previous => ({
          workspace, status: previous.workspace === workspace ? previous.status : null,
          error: error instanceof Error ? error.message : String(error),
        }))
      } finally {
        pending = false
        if (!cancelled && current !== revision) void refresh()
      }
    }
    const invalidate = () => { void refresh() }
    void refresh()
    const timer = setInterval(() => { if (!pending) void refresh() }, 5000)
    window.addEventListener('focus', invalidate)
    window.addEventListener(REPOSITORY_CHANGED, invalidate)
    return () => {
      cancelled = true
      clearInterval(timer)
      window.removeEventListener('focus', invalidate)
      window.removeEventListener(REPOSITORY_CHANGED, invalidate)
    }
  }, [workspace])
  return snapshot.workspace === workspace ? snapshot : { workspace, status: null, error: '' }
}
