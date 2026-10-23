import { DndContext, useDraggable, type DragEndEvent } from '@dnd-kit/core'
import type { Editor } from '@tiptap/react'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTemplateStore } from '../../stores/templateStore'
import type { TemplateSnippet } from '../../lib/templateSnippets'
import { SNIPPET_GROUPS, SNIPPETS, type Snippet } from './snippets'

type PaletteSnippet = Snippet | TemplateSnippet

function DraggableSnippet({ snippet, onInsert }: { snippet: PaletteSnippet; onInsert: () => void }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: snippet.id })
  return (
    <button
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onDoubleClick={onInsert}
      style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined}
      className="w-full cursor-grab rounded border border-white/10 bg-white/5 px-3 py-2 text-left text-sm hover:bg-white/10"
    >
      {snippet.label}
    </button>
  )
}

/**
 * Drag a snippet onto the page, or double-click it to insert at the cursor.
 * Drops are detected by the page element carrying `data-page-drop`.
 */
export function SnippetPalette({ editor }: { editor: Editor | null }) {
  const canInsert = useSettingsStore((s) => s.viewMode === 'edit')
  const templates = useTemplateStore((s) => s.templates)
  const custom = templates.flatMap((template) => template.snippets ?? [])
  const snippets: PaletteSnippet[] = [...SNIPPETS, ...custom]
  const groups = [...new Set<string>([...SNIPPET_GROUPS, ...custom.map((snippet) => snippet.group)])]
  const insert = (snippet: PaletteSnippet) => {
    if (canInsert) editor?.chain().focus().insertContent('markdown' in snippet ? snippet.markdown : snippet.node).run()
  }

  const onDragEnd = ({ active, activatorEvent }: DragEndEvent) => {
    const snippet = snippets.find((s) => s.id === active.id)
    if (!snippet || !(activatorEvent instanceof MouseEvent)) return
    const dropPoint = document.elementFromPoint(
      activatorEvent.clientX + (activatorEvent.movementX ?? 0),
      activatorEvent.clientY,
    )
    if (dropPoint?.closest('.grimoire-page')) insert(snippet)
  }

  return (
    <DndContext onDragEnd={onDragEnd}>
      <div className="flex flex-col gap-2 p-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-white/50">Snippets</h2>
        {!canInsert && <p className="text-xs text-amber-400">Switch to Edit view to insert snippets.</p>}
        {groups.map((group) => (
          <details key={group} open className="group" aria-label={group}>
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded px-1 py-1 text-xs font-semibold uppercase tracking-wide text-white/50 hover:bg-white/5 [&::-webkit-details-marker]:hidden">
              <span aria-hidden="true" className="inline-block transition-transform group-open:rotate-90">▸</span>
              {group}
            </summary>
            <div className="mt-2 flex flex-col gap-2">
              {snippets.filter((s) => s.group === group).map((snippet) => (
                <DraggableSnippet key={snippet.id} snippet={snippet} onInsert={() => insert(snippet)} />
              ))}
            </div>
          </details>
        ))}
      </div>
    </DndContext>
  )
}
