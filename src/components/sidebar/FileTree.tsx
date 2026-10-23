import { useState } from 'react'
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { useDocumentStore } from '../../stores/documentStore'
import { useFileSystem } from '../../hooks/useFileSystem'
import type { FileNode } from '../../types/document'

type Editing =
  | { kind: 'new-file' | 'new-folder'; dir: string }
  | { kind: 'rename'; path: string }

interface TreeContext {
  selected: string | null
  editing: Editing | null
  onSelect: (node: FileNode) => void
  onOpen: (path: string) => void
  onSubmit: (name: string) => void
  onCancel: () => void
  onStartRename: (path: string) => void
}

const parentOf = (path: string): string => path.slice(0, path.lastIndexOf('/'))

function InlineInput({
  initial = '',
  placeholder,
  onSubmit,
  onCancel,
}: {
  initial?: string
  placeholder?: string
  onSubmit: (name: string) => void
  onCancel: () => void
}) {
  return (
    <input
      autoFocus
      defaultValue={initial}
      placeholder={placeholder}
      className="w-full rounded bg-white/10 px-1 text-sm outline-none ring-1 ring-white/30"
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onSubmit(e.currentTarget.value)
        if (e.key === 'Escape') onCancel()
      }}
      onBlur={onCancel}
    />
  )
}

function Node({ node, ctx }: { node: FileNode; ctx: TreeContext }) {
  const drag = useDraggable({ id: node.path })
  const drop = useDroppable({ id: node.path, disabled: !node.isDirectory })
  const renaming = ctx.editing?.kind === 'rename' && ctx.editing.path === node.path
  const creatingHere =
    node.isDirectory &&
    ctx.editing &&
    ctx.editing.kind !== 'rename' &&
    ctx.editing.dir === node.path

  const row = renaming ? (
    <InlineInput initial={node.name} onSubmit={ctx.onSubmit} onCancel={ctx.onCancel} />
  ) : (
    <div
      ref={drag.setNodeRef}
      {...drag.listeners}
      {...drag.attributes}
      className={[
        'group flex cursor-pointer items-center justify-between rounded px-1',
        ctx.selected === node.path ? 'bg-white/15' : 'hover:bg-white/5',
        drop.isOver ? 'ring-1 ring-amber-400' : '',
        drag.isDragging ? 'opacity-40' : '',
      ].join(' ')}
      onClick={() => {
        ctx.onSelect(node)
        if (!node.isDirectory) ctx.onOpen(node.path)
      }}
    >
      <span className={node.isDirectory ? 'text-white/60' : ''}>
        {node.isDirectory ? '▾ ' : ''}
        {node.name}
      </span>
      <button
        className="invisible text-xs text-white/50 hover:text-white group-hover:visible"
        title="Rename"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          ctx.onStartRename(node.path)
        }}
      >
        ✎
      </button>
    </div>
  )

  return (
    <li ref={node.isDirectory ? drop.setNodeRef : undefined}>
      {row}
      {node.isDirectory && (
        <ul className="ml-3">
          {creatingHere && (
            <li>
              <InlineInput
                placeholder={ctx.editing?.kind === 'new-folder' ? 'folder name' : 'file name'}
                onSubmit={ctx.onSubmit}
                onCancel={ctx.onCancel}
              />
            </li>
          )}
          {node.children?.map((c) => (
            <Node key={c.path} node={c} ctx={ctx} />
          ))}
        </ul>
      )}
    </li>
  )
}

export function FileTree() {
  const tree = useDocumentStore((s) => s.tree)
  const root = useDocumentStore((s) => s.workspaceRoot)
  const { openWorkspace, openFile, createFile, createFolder, renameEntry, moveEntry } =
    useFileSystem()
  const [selected, setSelected] = useState<FileNode | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [error, setError] = useState<string | null>(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const rootDrop = useDroppable({ id: root ?? '__none__', disabled: !root })

  const run = async (action: () => Promise<unknown>) => {
    try {
      setError(null)
      await action()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setEditing(null)
    }
  }

  const targetDir = (): string | null => {
    if (!root) return null
    if (!selected) return root
    return selected.isDirectory ? selected.path : parentOf(selected.path)
  }

  const startCreate = (kind: 'new-file' | 'new-folder') => {
    const dir = targetDir()
    if (dir) setEditing({ kind, dir })
  }

  const onSubmit = (name: string) => {
    if (!editing) return
    if (editing.kind === 'rename') return run(() => renameEntry(editing.path, name))
    if (editing.kind === 'new-folder') return run(() => createFolder(editing.dir, name))
    return run(async () => openFile(await createFile(editing.dir, name)))
  }

  const onDragEnd = (event: DragEndEvent) => {
    const from = String(event.active.id)
    const dir = event.over ? String(event.over.id) : null
    if (!dir || parentOf(from) === dir) return
    const name = from.slice(from.lastIndexOf('/') + 1)
    void run(() => moveEntry(from, `${dir}/${name}`))
  }

  const ctx: TreeContext = {
    selected: selected?.path ?? null,
    editing,
    onSelect: setSelected,
    onOpen: (path) => void openFile(path),
    onSubmit: (name) => void onSubmit(name),
    onCancel: () => setEditing(null),
    onStartRename: (path) => setEditing({ kind: 'rename', path }),
  }

  const creatingAtRoot = editing && editing.kind !== 'rename' && editing.dir === root

  return (
    <div className="p-3 text-sm">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-white/50">Files</h2>
        <div className="flex items-center gap-2 text-xs">
          <button
            className="disabled:opacity-30"
            title="New file"
            disabled={!root}
            onClick={() => startCreate('new-file')}
          >
            + File
          </button>
          <button
            className="disabled:opacity-30"
            title="New folder"
            disabled={!root}
            onClick={() => startCreate('new-folder')}
          >
            + Folder
          </button>
          <button className="underline" onClick={openWorkspace}>
            Open
          </button>
        </div>
      </div>
      {error && <p className="mb-2 text-xs text-red-400">{error}</p>}
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <ul
          ref={rootDrop.setNodeRef}
          className={`min-h-8 rounded ${rootDrop.isOver ? 'ring-1 ring-amber-400' : ''}`}
        >
          {creatingAtRoot && (
            <li>
              <InlineInput
                placeholder={editing.kind === 'new-folder' ? 'folder name' : 'file name'}
                onSubmit={ctx.onSubmit}
                onCancel={ctx.onCancel}
              />
            </li>
          )}
          {tree.map((n) => (
            <Node key={n.path} node={n} ctx={ctx} />
          ))}
        </ul>
      </DndContext>
      {!root && <p className="text-xs text-white/40">Open a folder to manage files.</p>}
    </div>
  )
}
