import { useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { DndContext, DragOverlay, PointerSensor, useDraggable, useSensor, useSensors, type DragEndEvent, type DragMoveEvent } from '@dnd-kit/core'
import type { Editor } from '@tiptap/react'
import { useTemplateStore } from '../../stores/templateStore'
import { useModStore } from '../../stores/modStore'
import type { TemplateSnippet } from '../../lib/templateSnippets'
import { SNIPPETS, type Snippet } from './snippets'
import { findSnippetDropTarget } from '../../lib/snippetDrop'
import { insertContentBox } from '../../lib/contentBoxes'
import { useTranslation } from '../../lib/i18n'

type PaletteSnippet = Snippet | TemplateSnippet

interface SnippetFolderNode {
  items: PaletteSnippet[]
  children: Map<string, SnippetFolderNode>
}

function buildFolderTree(items: PaletteSnippet[]): SnippetFolderNode {
  const root: SnippetFolderNode = { items: [], children: new Map() }
  for (const snippet of items) {
    const segments = snippet.subgroup?.split('/').map((s) => s.trim()).filter(Boolean) ?? []
    let cursor = root
    for (const segment of segments) {
      let child = cursor.children.get(segment)
      if (!child) {
        child = { items: [], children: new Map() }
        cursor.children.set(segment, child)
      }
      cursor = child
    }
    cursor.items.push(snippet)
  }
  return root
}

function DraggableSnippet({ snippet, onInsert }: { snippet: PaletteSnippet; onInsert: () => void }) {
  const { t } = useTranslation()
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: snippet.id })
  return (
    <button
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      type="button"
      title={t('snippets.dragTooltip')}
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
  const { t } = useTranslation()
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [caret, setCaret] = useState<{ left: number; top: number; height: number } | null>(null)
  const templates = useTemplateStore((s) => s.templates)
  const ready = useModStore((s) => s.ready)
  const folderSnippets = useModStore((s) => s.snippets)
  const custom = templates.flatMap((template) => template.snippets ?? [])
  const snippets: PaletteSnippet[] = [...(ready ? folderSnippets : SNIPPETS), ...custom]
  const groups = [...new Set(snippets.map((snippet) => snippet.group))]
  const insert = (snippet: PaletteSnippet) => {
    if (editor) insertContentBox(editor, 'markdown' in snippet ? snippet.markdown : snippet.node)
  }

  const renderTree = (node: SnippetFolderNode): ReactNode => (
    <>
      {node.items.map((snippet) => (
        <DraggableSnippet key={snippet.id} snippet={snippet} onInsert={() => insert(snippet)} />
      ))}
      {Array.from(node.children.entries()).map(([folderName, childNode]) => (
        <details key={folderName} aria-label={folderName} className="pl-2 [&[open]>summary>span:first-child]:rotate-90">
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded px-1 py-1 text-xs font-semibold tracking-wide text-white/60 hover:bg-white/5 [&::-webkit-details-marker]:hidden">
            <span aria-hidden="true" className="inline-block transition-transform">▸</span>
            {folderName}
          </summary>
          <div className="mt-1.5 flex flex-col gap-1.5 pl-2">
            {renderTree(childNode)}
          </div>
        </details>
      ))}
    </>
  )

  const resolveDrop = ({ activatorEvent, delta }: DragMoveEvent | DragEndEvent) => {
    if (!(activatorEvent instanceof MouseEvent)) return null
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
        <h2 className="text-xs font-semibold uppercase tracking-wide text-white/50">{t('snippets.title')}</h2>
        {groups.map((group) => {
          const tree = buildFolderTree(snippets.filter((s) => s.group === group))
          return (
            <details key={group} className="group [&[open]>summary>span:first-child]:rotate-90" aria-label={group}>
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded px-1 py-1 text-xs font-semibold uppercase tracking-wide text-white/50 hover:bg-white/5 [&::-webkit-details-marker]:hidden">
                <span aria-hidden="true" className="inline-block transition-transform">▸</span>
                {group}
              </summary>
              <div className="mt-2 flex flex-col gap-2">
                {renderTree(tree)}
              </div>
            </details>
          )
        })}
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
