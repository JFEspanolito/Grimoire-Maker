import { useState } from 'react'

/** Decoupled scratchpad for lore notes; kept in memory until persistence lands. */
export function ResearchPanel() {
  const [notes, setNotes] = useState('')
  return (
    <div className="flex h-full flex-col p-3">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/50">Research</h2>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Lore, references, NPC ideas…"
        className="min-h-40 flex-1 resize-none rounded border border-white/10 bg-black/20 p-2 text-sm outline-none"
      />
    </div>
  )
}
