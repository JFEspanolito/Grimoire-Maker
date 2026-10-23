import { useEffect, useState } from 'react'
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
import { useSessionStore } from '../../stores/sessionStore'
import { useFileSystem } from '../../hooks/useFileSystem'
import { splitBinder } from '../../lib/binder'
import type { FileNode } from '../../types/document'

type Editing =
  | { kind: 'new-file' | 'new-folder'; dir: string }
  | { kind: 'rename'; path: string }

interface TreeContext {
  selected: string | null
  editing: Editing | null
  collapsed: ReadonlySet<string>
  onSelect: (node: FileNode) => void
  onToggle: (path: string) => void
  onOpen: (path: string) => void
  onSubmit: (name: string) => void
  onCancel: () => void
  onStartRename: (path: string) => void
  onContextMenu: (node: FileNode, x: number, y: number) => void
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
  const expanded = !ctx.collapsed.has(node.path)
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
        'group flex w-full cursor-pointer items-center rounded px-1 text-left',
        ctx.selected === node.path ? 'bg-white/15' : 'hover:bg-white/5',
        drop.isOver ? 'ring-1 ring-amber-400' : '',
        drag.isDragging ? 'opacity-40' : '',
      ].join(' ')}
      onClick={() => {
        ctx.onSelect(node)
        if (node.isDirectory) ctx.onToggle(node.path)
        else ctx.onOpen(node.path)
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        ctx.onContextMenu(node, event.clientX, event.clientY)
      }}
    >
      {node.isDirectory && (
        <button
          type="button"
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${node.name}`}
          aria-expanded={expanded}
          className="mr-1 text-white/60"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            ctx.onSelect(node)
            ctx.onToggle(node.path)
          }}
        >
          {expanded ? '▾' : '▸'}
        </button>
      )}
      <span className={node.isDirectory ? 'text-white/60' : ''}>
        {node.name}
      </span>
      <button
        className="invisible ml-auto text-xs text-white/50 hover:text-white group-hover:visible"
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
      {node.isDirectory && expanded && (
        <ul className="ml-2.5 text-left">
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
  const recent = useSessionStore((s) => s.recentWorkspaces)
  const workspaceError = useSessionStore((s) => s.workspaceError)
  const { openWorkspace, openRecent, openFile, openFolder, createFile, createFolder, renameEntry, moveEntry, importInto } =
    useFileSystem()
  const [selected, setSelected] = useState<FileNode | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [editing, setEditing] = useState<Editing | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ node: FileNode; x: number; y: number } | null>(null)

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menu])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const rootDrop = useDroppable({ id: root ?? '__none__', disabled: !root })
  const binder = splitBinder(tree)
  const nodes = binder
    ? [binder.draft, binder.research, binder.trash, ...binder.other].filter((node): node is FileNode => node !== null)
    : tree

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
    if (!selected || !selected.path.startsWith(`${root}/`)) return binder?.draft?.path ?? root
    return selected.isDirectory ? selected.path : parentOf(selected.path)
  }

  const startCreate = (kind: 'new-file' | 'new-folder') => {
    const dir = targetDir()
    if (dir) {
      setCollapsed((current) => {
        const next = new Set(current)
        next.delete(dir)
        return next
      })
      setEditing({ kind, dir })
    }
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

  const trashPath = binder?.trash?.path ?? (root ? `${root}/Trash` : null)
  const inTrash = !!menu && !!trashPath && (menu.node.path === trashPath || menu.node.path.startsWith(`${trashPath}/`))
  const isBinderRoot = !!menu && !!root && ['Draft', 'Research', 'Trash']
    .some((name) => menu.node.path.toLowerCase() === `${root}/${name}`.toLowerCase())

  const deleteEntry = async (node: FileNode) => {
    if (!trashPath || node.path.startsWith(`${trashPath}/`) || node.path === trashPath) return
    await moveEntry(node.path, `${trashPath}/${node.name}`)
    setMenu(null)
  }

  const ctx: TreeContext = {
    selected: selected?.path ?? null,
    editing,
    collapsed,
    onSelect: setSelected,
    onToggle: (path) => setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    }),
    onOpen: (path) => void run(() => openFile(path)),
    onSubmit: (name) => void onSubmit(name),
    onCancel: () => setEditing(null),
    onStartRename: (path) => setEditing({ kind: 'rename', path }),
    onContextMenu: (node, x, y) => { setSelected(node); setMenu({ node, x, y }) },
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
      <div className="mb-2 flex flex-wrap gap-2 text-xs" aria-label="Import files">
        <button type="button" disabled={!root} className="disabled:opacity-30" onClick={() => void run(() => importInto('Draft'))}>Import to Draft</button>
        <button type="button" disabled={!root} className="disabled:opacity-30" onClick={() => void run(() => importInto('Research'))}>Import to Research</button>
      </div>
      {recent.length > 0 && (
        <select
          aria-label="Recent folders"
          className="mb-2 w-full rounded bg-transparent text-xs text-white/70"
          value=""
          onChange={(e) => e.target.value && void run(() => openRecent(e.target.value))}
        >
          <option value="" className="text-black">
            Recent folders…
          </option>
          {recent.map((path) => (
            <option key={path} value={path} title={path} className="text-black">
              {path.slice(path.lastIndexOf('/') + 1) || path}
            </option>
          ))}
        </select>
      )}
      {error && <p className="mb-2 text-xs text-red-400">{error}</p>}
      {workspaceError && <p className="mb-2 text-xs text-amber-400" role="alert">{workspaceError}</p>}
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <ul
          ref={rootDrop.setNodeRef}
          className={`min-h-8 rounded text-left ${rootDrop.isOver ? 'ring-1 ring-amber-400' : ''}`}
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
          {nodes.map((n) => (
            <Node key={n.path} node={n} ctx={ctx} />
          ))}
        </ul>
      </DndContext>
      {menu && (
        <div role="menu" aria-label={`${menu.node.name} actions`}
          className="fixed z-50 min-w-36 rounded border border-white/20 bg-neutral-800 p-1 shadow-xl"
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={(event) => event.stopPropagation()}>
          {menu.node.isDirectory ? (
            <button type="button" role="menuitem" className="block w-full rounded px-2 py-1 text-left hover:bg-white/10"
              onClick={() => { const path = menu.node.path; setMenu(null); void run(() => openFolder(path)) }}>
              Open Folder
            </button>
          ) : (
            <button type="button" role="menuitem" className="block w-full rounded px-2 py-1 text-left hover:bg-white/10"
              onClick={() => { const path = menu.node.path; setMenu(null); void run(() => openFile(path)) }}>
              Open
            </button>
          )}
          {!menu.node.isDirectory && (
            <button type="button" role="menuitem" className="block w-full rounded px-2 py-1 text-left hover:bg-white/10"
              onClick={() => { const path = menu.node.path; setMenu(null); void run(() => openFile(path, true)) }}>
              Open in New Tab
            </button>
          )}
          {!inTrash && !isBinderRoot && (
            <button type="button" role="menuitem" className="block w-full rounded px-2 py-1 text-left hover:bg-white/10"
              onClick={() => void run(() => deleteEntry(menu.node))}>
              Move to Trash
            </button>
          )}
        </div>
      )}
      {!root && <p className="text-xs text-white/40">Open a folder to manage files.</p>}
    </div>
  )
}
