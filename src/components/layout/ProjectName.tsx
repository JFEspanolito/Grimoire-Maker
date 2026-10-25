import { useEffect, useState } from 'react'
import { EMPTY_ENTRY, useProjectStore } from '../../stores/projectStore'
import { projectName } from '../../lib/binder'
import { useDocumentStore } from '../../stores/documentStore'

/** Edits shared book metadata without renaming or moving the project folder. */
export function ProjectName() {
  const root = useDocumentStore((state) => state.workspaceRoot)
  const entry = useProjectStore(state => root ? state.entries[root] ?? EMPTY_ENTRY : EMPTY_ENTRY)
  useEffect(() => {
    if (root && !useProjectStore.getState().entries[root]?.ready) void useProjectStore.getState().load(root)
  }, [root])
  const [editing, setEditing] = useState<{ root: string; value: string } | null>(null)
  const busy = entry.busy
  const error = entry.error
  const name = entry.settings.name || projectName(root)
  const isEditing = !!root && editing?.root === root

  const submit = async () => {
    const next = editing?.value.trim()
    if (!next || !root || busy || !entry.ready) return
    if (next === name) {
      setEditing(null)
      return
    }
    const settings = useProjectStore.getState().entries[root].settings
    if (await useProjectStore.getState().save(root, { ...settings, name: next })) {
      setEditing(current => current?.root === root ? null : current)
    }
  }

  return (
    <div className="mr-2 min-w-0 text-sm font-semibold">
      {isEditing ? (
        <form className="flex min-w-0 items-center gap-1" onSubmit={(event) => { event.preventDefault(); void submit() }}>
          <input
            autoFocus
            maxLength={500}
            aria-label="Project name"
            className="min-w-0 flex-1 rounded bg-white/10 px-1 text-left outline-none ring-1 ring-white/30"
            value={editing.value}
            disabled={busy}
            onChange={(event) => setEditing({ root, value: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setEditing(null)
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
            title={root ? 'Edit book name (folder stays unchanged)' : 'Open a project to edit its name'}
            disabled={!root || !entry.ready || busy}
            className="shrink-0 text-white/50 hover:text-white disabled:opacity-30"
            onClick={() => {
              if (!root) return
              setEditing({ root, value: name })
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
