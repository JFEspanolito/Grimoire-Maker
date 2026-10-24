import { useState } from 'react'
import { createPortal } from 'react-dom'
import { DndContext, DragOverlay, PointerSensor, useDraggable, useSensor, useSensors, type DragEndEvent, type DragMoveEvent } from '@dnd-kit/core'
import type { Editor } from '@tiptap/react'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTemplateStore } from '../../stores/templateStore'
import { useModStore } from '../../stores/modStore'
import type { TemplateSnippet } from '../../lib/templateSnippets'
import { SNIPPETS, type Snippet } from './snippets'
import { findSnippetDropTarget } from '../../lib/snippetDrop'
import { insertContentBox } from '../../lib/contentBoxes'

type PaletteSnippet = Snippet | TemplateSnippet

function DraggableSnippet({ snippet, onInsert, disabled }: { snippet: PaletteSnippet; onInsert: () => void; disabled: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: snippet.id, disabled })
  return (
    <button
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      type="button"
      disabled={disabled}
      title="Drag onto the page to choose a position, or double-click to insert at the cursor"
      onDoubleClick={onInsert}
      onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); onInsert() } }}
      style={{ opacity: isDragging ? 0.4 : 1, touchAction: 'none' }}
      className="w-full cursor-grab rounded border border-white/10 bg-white/5 px-3 py-2 text-left text-sm hover:bg-white/10 disabled:opacity-30"
    >
      {snippet.label}
    </button>
  )
}

/**
 * Drag a snippet onto the page, or double-click it to insert at the cursor.
 * Drop coordinates select both the document pane and the insertion position.
 */
export function SnippetPalette({ editor }: { editor: Editor | null }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [caret, setCaret] = useState<{ left: number; top: number; height: number } | null>(null)
  const canInsert = useSettingsStore((s) => s.viewMode === 'edit')
  const templates = useTemplateStore((s) => s.templates)
  const ready = useModStore((s) => s.ready)
  const folderSnippets = useModStore((s) => s.snippets)
  const custom = templates.flatMap((template) => template.snippets ?? [])
  const snippets: PaletteSnippet[] = [...(ready ? folderSnippets : SNIPPETS), ...custom]
  const groups = [...new Set(snippets.map((snippet) => snippet.group))]
  const insert = (snippet: PaletteSnippet) => {
    if (canInsert && editor) insertContentBox(editor, 'markdown' in snippet ? snippet.markdown : snippet.node)
  }

  const resolveDrop = ({ activatorEvent, delta }: DragMoveEvent | DragEndEvent) => {
    if (!canInsert || !(activatorEvent instanceof MouseEvent)) return null
    return findSnippetDropTarget(activatorEvent.clientX + delta.x, activatorEvent.clientY + delta.y)
  }
  const onDragEnd = (event: DragEndEvent) => {
    const { active } = event
    const snippet = snippets.find((s) => s.id === active.id)
    const target = resolveDrop(event)
    setDraggedId(null)
    setCaret(null)
    if (snippet && target) insertContentBox(target.editor, 'markdown' in snippet ? snippet.markdown : snippet.node, target.position)
  }
  const dragged = snippets.find((snippet) => snippet.id === draggedId)

  return (
    <DndContext sensors={sensors} onDragStart={({ active }) => setDraggedId(String(active.id))}
      onDragEnd={onDragEnd} onDragCancel={() => { setDraggedId(null); setCaret(null) }}
      onDragMove={(event) => {
        const target = resolveDrop(event)
        if (!target) { setCaret(null); return }
        const point = target.editor.view.coordsAtPos(target.position)
        setCaret({ left: point.left, top: point.top, height: Math.max(18, point.bottom - point.top) })
      }}>
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
                <DraggableSnippet key={snippet.id} snippet={snippet} disabled={!canInsert} onInsert={() => insert(snippet)} />
              ))}
            </div>
          </details>
        ))}
      </div>
      {dragged && createPortal(<>
        <DragOverlay dropAnimation={null} style={{ pointerEvents: 'none' }}>
          <div className="rounded border border-amber-400 bg-neutral-900 px-3 py-2 text-sm text-white shadow-lg">{dragged.label}</div>
        </DragOverlay>
        {caret && <div aria-hidden="true" style={{ position: 'fixed', pointerEvents: 'none', zIndex: 1000,
          left: caret.left, top: caret.top, height: caret.height, borderLeft: '3px solid #f59e0b' }} />}
      </>, document.body)}
    </DndContext>
  )
}
