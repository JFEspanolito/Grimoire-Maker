import { useDocumentStore } from '../../stores/documentStore'
import { serializeDocument } from '../../lib/frontmatter'
import { documentLabel } from '../../lib/documentLabel'
import { useState } from 'react'
import type { GrimoireDocument } from '../../types/document'
import { emitPluginEvent } from '../../plugins/plugin-manager'

interface SourceDraft { raw: string; snapshot: GrimoireDocument | undefined }

/** Keep the typed source intact while synchronizing the existing document buffer. */
export function MarkdownSourceView({ path }: { path: string }) {
  const document = useDocumentStore(state => state.buffers[path])
  const [draft, setDraft] = useState<SourceDraft | null>(null)
  const raw = draft && draft.snapshot === document ? draft.raw : document ? serializeDocument(document.frontmatter, document.body) : ''
  return <textarea aria-label={`Markdown source for ${documentLabel(path.slice(path.lastIndexOf('/') + 1))}`}
    spellCheck={false} value={raw}
    className="block h-full min-h-80 w-full resize-none border-0 bg-transparent p-4 font-mono text-sm text-white/80 focus:outline-none"
    onChange={event => {
      const raw = event.target.value
      useDocumentStore.getState().setRawForPath(path, raw)
      setDraft({ raw, snapshot: useDocumentStore.getState().buffers[path] })
      emitPluginEvent('document:changed')
    }} />
}
