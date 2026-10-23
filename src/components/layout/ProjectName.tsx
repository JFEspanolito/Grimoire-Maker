import { useState } from 'react'
import { useFileSystem } from '../../hooks/useFileSystem'
import { projectName } from '../../lib/binder'
import { useDocumentStore } from '../../stores/documentStore'

/** Edits the project directory name, never an individual chapter title. */
export function ProjectName() {
  const root = useDocumentStore((state) => state.workspaceRoot)
  const { renameWorkspace } = useFileSystem()
  const [editing, setEditing] = useState<{ root: string; value: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const name = projectName(root)
  const isEditing = !!root && editing?.root === root

  const submit = async () => {
    const next = editing?.value.trim()
    if (!next || !root) return
    if (next === name) {
      setEditing(null)
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (await renameWorkspace(next)) setEditing(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mr-2 min-w-0 text-sm font-semibold">
      {isEditing ? (
        <form className="flex min-w-0 items-center gap-1" onSubmit={(event) => { event.preventDefault(); void submit() }}>
          <input
            autoFocus
            aria-label="Project name"
            className="min-w-0 flex-1 rounded bg-white/10 px-1 text-left outline-none ring-1 ring-white/30"
            value={editing.value}
            disabled={busy}
            onChange={(event) => setEditing({ root, value: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setEditing(null)
                setError(null)
              }
            }}
          />
          <button type="submit" aria-label="Save project name" disabled={busy}>✓</button>
          <button type="button" aria-label="Cancel project rename" disabled={busy} onClick={() => setEditing(null)}>✕</button>
        </form>
      ) : (
        <div className="flex min-w-0 items-center gap-1 text-left">
          <span className="truncate" title={root ?? undefined}>{name}</span>
          <button
            type="button"
            aria-label="Rename project"
            title={root ? 'Rename project folder' : 'Open a project folder to rename it'}
            disabled={!root}
            className="shrink-0 text-white/50 hover:text-white disabled:opacity-30"
            onClick={() => {
              if (!root) return
              setEditing({ root, value: name })
              setError(null)
            }}
          >
            ✎
          </button>
        </div>
      )}
      {error && <span role="alert" className="text-xs text-red-400">{error}</span>}
    </div>
  )
}
