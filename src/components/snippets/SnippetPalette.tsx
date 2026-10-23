import { DndContext, useDraggable, type DragEndEvent } from '@dnd-kit/core'
import type { Editor } from '@tiptap/react'
import { READ_ALOUD_TEMPLATE, STATBLOCK_TEMPLATE } from '../editor/extensions/blocks'

interface Snippet {
  id: string
  label: string
  node: object
}

const SNIPPETS: Snippet[] = [
  { id: 'statblock', label: 'Statblock', node: STATBLOCK_TEMPLATE },
  { id: 'read-aloud', label: 'Read-aloud box', node: READ_ALOUD_TEMPLATE },
]

function DraggableSnippet({ snippet, onInsert }: { snippet: Snippet; onInsert: () => void }) {
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
  const insert = (snippet: Snippet) => editor?.chain().focus().insertContent(snippet.node).run()

  const onDragEnd = ({ active, activatorEvent }: DragEndEvent) => {
    const snippet = SNIPPETS.find((s) => s.id === active.id)
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
        {SNIPPETS.map((snippet) => (
          <DraggableSnippet key={snippet.id} snippet={snippet} onInsert={() => insert(snippet)} />
        ))}
      </div>
    </DndContext>
  )
}
