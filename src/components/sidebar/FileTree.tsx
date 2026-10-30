import { reportError } from "../../lib/errorLogging";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ConfirmDialog } from "../layout/ConfirmDialog";
import { useTranslation, type TranslationKey } from "../../lib/i18n";
import {
  DndContext,
  DragOverlay,
  pointerWithin,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useDocumentStore } from "../../stores/documentStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useFileSystem } from "../../hooks/useFileSystem";
import { splitBinder } from "../../lib/binder";
import type { FileNode } from "../../types/document";
import { useExplorerStore } from "../../stores/explorerStore";
import { EXPLORER_SHORTCUTS } from "../../lib/shortcuts";
import { imageReference, isImageFile } from "../../lib/assetPaths";
import { findSnippetDropTarget } from "../../lib/snippetDrop";
import { newImageAttrs } from "../../lib/insertActions";

const fileLabel = (name: string, isDirectory = false): string =>
  isDirectory ? name : name.replace(/(?<=.)\.[^.]+$/, "");

const defaultFolderDescriptions: Record<string, TranslationKey> = {
  draft: "files.desc.draft",
  research: "files.desc.research",
  trash: "files.desc.trash",
  assets: "files.desc.assets",
};

type Editing =
  | { kind: "new-file" | "new-folder"; dir: string }
  | { kind: "rename"; path: string; extension: string };

const renameState = (node: FileNode): Editing => ({
  kind: "rename", path: node.path,
  extension: node.isDirectory ? "" : node.name.slice(fileLabel(node.name).length),
});

interface TreeContext {
  root: string | null;
  selected: string | null;
  editing: Editing | null;
  collapsed: ReadonlyMap<string, boolean>;
  onSelect: (node: FileNode) => void;
  onToggle: (path: string) => void;
  onOpen: (path: string) => void;
  onSubmit: (name: string) => void;
  onCancel: () => void;
  onStartRename: (node: FileNode) => void;
  onContextMenu: (node: FileNode, x: number, y: number) => void;
}

const collapsedByDefault = (path: string) => /(?:^|[\\/])assets?$/i.test(path);
const parentOf = (path: string): string => path.slice(0, path.lastIndexOf("/"));
const actionButton =
  "rounded px-2 py-1 hover:bg-white/15 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 disabled:opacity-30 disabled:pointer-events-none";

function InlineInput({
  initial = "",
  placeholder,
  onSubmit,
  onCancel,
  commitOnBlur = false,
}: {
  initial?: string;
  placeholder?: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
  commitOnBlur?: boolean;
}) {
  const finished = useRef(false);
  const finish = (value: string, cancel = false) => {
    if (finished.current) return;
    finished.current = true;
    if (cancel || (commitOnBlur && (!value.trim() || value.trim() === initial))) onCancel();
    else onSubmit(value);
  };
  return (
    <input
      autoFocus
      defaultValue={initial}
      placeholder={placeholder}
      className="w-full rounded bg-white/10 px-1 text-sm outline-none ring-1 ring-white/30"
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter" || e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          finish(e.currentTarget.value, e.key === "Escape");
        }
      }}
      onBlur={(e) => finish(e.currentTarget.value, !commitOnBlur)}
    />
  );
}

function Node({ node, ctx }: { node: FileNode; ctx: TreeContext }) {
  const { t } = useTranslation();
  const label = fileLabel(node.name, node.isDirectory);
  const folderKey = node.name.toLowerCase();
  const defaultFolderTooltip =
    node.isDirectory &&
    node.path.toLowerCase() === `${ctx.root}/${node.name}`.toLowerCase() &&
    folderKey in defaultFolderDescriptions
      ? t(defaultFolderDescriptions[folderKey])
      : undefined;
  const sectionRoot = ["Draft", "Research", "Trash"].some(
    (section) =>
      node.path.toLowerCase() === `${ctx.root}/${section}`.toLowerCase(),
  );
  const drag = useDraggable({
    id: node.path,
    disabled: sectionRoot,
    data: { label },
  });
  const drop = useDroppable({
    id: node.path,
    data: { directory: node.isDirectory ? node.path : parentOf(node.path) },
  });
  const expanded = !(
    ctx.collapsed.get(node.path) ?? collapsedByDefault(node.path)
  );
  const renaming =
    ctx.editing?.kind === "rename" && ctx.editing.path === node.path;
  const creatingHere =
    node.isDirectory &&
    ctx.editing &&
    ctx.editing.kind !== "rename" &&
    ctx.editing.dir === node.path;

  const row = renaming ? (
    <InlineInput
      initial={label}
      commitOnBlur
      onSubmit={ctx.onSubmit}
      onCancel={ctx.onCancel}
    />
  ) : (
    <div
      ref={(element) => {
        drag.setNodeRef(element);
        drop.setNodeRef(element);
      }}
      data-tree-path={node.path}
      title={defaultFolderTooltip}
      {...drag.listeners}
      {...drag.attributes}
      className={[
        "group flex w-full cursor-pointer items-center rounded px-1 text-left",
        ctx.selected === node.path ? "bg-white/15" : "hover:bg-white/5",
        drop.isOver ? "ring-1 ring-amber-400" : "",
        drag.isDragging ? "opacity-40" : "",
      ].join(" ")}
      onClick={() => {
        ctx.onSelect(node);
        if (node.isDirectory) ctx.onToggle(node.path);
        else ctx.onOpen(node.path);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        ctx.onContextMenu(node, event.clientX, event.clientY);
      }}
    >
      {node.isDirectory && (
        <button
          type="button"
          aria-label={`${expanded ? t("files.collapse") : t("files.expand")} ${node.name}`}
          aria-expanded={expanded}
          className="mr-1 text-white/60"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            ctx.onSelect(node);
            ctx.onToggle(node.path);
          }}
        >
          {expanded ? "▾" : "▸"}
        </button>
      )}
      {!node.isDirectory && (
        <span aria-hidden="true" className="mr-1 inline-block w-[1ch]" />
      )}
      <span className={node.isDirectory ? "text-white/60" : ""}>{label}</span>
      <button
        className="invisible ml-auto text-xs text-white/50 hover:text-white group-hover:visible"
        title={t("files.rename")}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          ctx.onStartRename(node);
        }}
      >
        ✎
      </button>
    </div>
  );

  return (
    <li>
      {row}
      {node.isDirectory && expanded && (
        <ul className="ml-2.5 text-left">
          {creatingHere && (
            <li>
              <InlineInput
                placeholder={
                  ctx.editing?.kind === "new-folder"
                    ? "folder name"
                    : "file name"
                }
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
  );
}

function RootDrop({
  path,
  children,
}: {
  path: string | null;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: path ?? "__none__",
    disabled: !path,
    data: { directory: path },
  });
  return (
    <ul
      ref={setNodeRef}
      className={`min-h-8 rounded text-left ${isOver ? "ring-1 ring-amber-400" : ""}`}
    >
      {children}
    </ul>
  );
}

export function FileTree() {
  const { t } = useTranslation();
  const tree = useDocumentStore((s) => s.tree);
  const root = useDocumentStore((s) => s.workspaceRoot);
  const workspaceError = useSessionStore((s) => s.workspaceError);
  const setWorkspaceError = useSessionStore((s) => s.setWorkspaceError);
  const {
    openFile,
    openFolder,
    createFile,
    createFolder,
    renameEntry,
    moveEntry,
    deleteFromTrash,
    refreshTree,
  } = useFileSystem();
  const [selected, setSelected] = useState<FileNode | null>(null);
  const [collapsed, setCollapsed] = useState<Map<string, boolean>>(
    () => new Map(),
  );
  const [editing, setEditing] = useState<Editing | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceError) return;
    const timer = setTimeout(() => {
      setWorkspaceError(null);
    }, 8000);
    return () => clearTimeout(timer);
  }, [workspaceError, setWorkspaceError]);

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => {
      setError(null);
    }, 8000);
    return () => clearTimeout(timer);
  }, [error]);
  const [menu, setMenu] = useState<{
    node: FileNode;
    x: number;
    y: number;
  } | null>(null);
  const [draggedLabel, setDraggedLabel] = useState<string | null>(null);
  const [imageCaret, setImageCaret] = useState<{ left: number; top: number; height: number } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<FileNode | null>(null);

  useEffect(() => {
    const onRenameKey = (event: KeyboardEvent) => {
      if (event.key !== EXPLORER_SHORTCUTS[0].keys[0] || event.defaultPrevented || event.isComposing
        || event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || editing || !selected || selected.isDirectory) return;
      if (document.querySelector('[role="dialog"], dialog[open]')) return;
      const target = event.target;
      if (target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"]')) return;
      const find = (nodes: FileNode[]): FileNode | undefined => {
        for (const node of nodes) {
          if (node.path === selected.path) return node;
          const nested = node.children && find(node.children);
          if (nested) return nested;
        }
      };
      const current = find(tree);
      if (!current || current.isDirectory) return;
      event.preventDefault();
      setMenu(null);
      setEditing(renameState(current));
    };
    window.addEventListener('keydown', onRenameKey);
    return () => window.removeEventListener('keydown', onRenameKey);
  }, [editing, selected, tree]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menu]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  const binder = splitBinder(tree);
  const nodes = binder
    ? [
        binder.draft,
        binder.research,
        binder.assets,
        binder.trash,
        ...binder.other,
      ].filter((node): node is FileNode => node !== null)
    : tree;

  const run = async (action: () => Promise<unknown>) => {
    try {
      setError(null);
      await action();
    } catch (e) {
      reportError("files.action", e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setEditing(null);
    }
  };

  const targetDir = (): string | null => {
    if (!root) return null;
    if (!selected || !selected.path.startsWith(`${root}/`))
      return binder?.draft?.path ?? root;
    return selected.isDirectory ? selected.path : parentOf(selected.path);
  };

  const startCreate = (kind: "new-file" | "new-folder") => {
    const dir = targetDir();
    if (dir) {
      setCollapsed((current) => {
        const next = new Map(current);
        next.set(dir, false);
        return next;
      });
      setEditing({ kind, dir });
    }
  };

  const onSubmit = (name: string) => {
    if (!editing) return;
    if (editing.kind === "rename") {
      const next = name.trim();
      const filename = `${next}${editing.extension}`;
      return run(async () => {
        await renameEntry(editing.path, filename);
        const path = `${parentOf(editing.path)}/${filename}`;
        setSelected(current => current?.path === editing.path ? { ...current, path, name: filename } : current);
        const explorer = useExplorerStore.getState();
        if (explorer.selectedPath === editing.path) explorer.selectPath(path);
      });
    }
    if (editing.kind === "new-folder")
      return run(() => createFolder(editing.dir, name));
    return run(async () => openFile(await createFile(editing.dir, name)));
  };

  const onDragEnd = (event: DragEndEvent) => {
    setDraggedLabel(null);
    setImageCaret(null);
    const from = String(event.active.id);
    // An image dropped on a page is inserted by reference: the file already exists in the project.
    if (isImageFile(from) && event.activatorEvent instanceof MouseEvent) {
      const target = findSnippetDropTarget(
        event.activatorEvent.clientX + event.delta.x,
        event.activatorEvent.clientY + event.delta.y,
      );
      if (target) {
        if (!target.documentPath)
          return setError(
            "Save this document as Markdown before adding images to it.",
          );
        setError(null);
        target.editor
          .chain()
          .focus()
          .setTextSelection(target.position)
          .insertContent({
            type: "image",
            attrs: newImageAttrs(imageReference(target.documentPath, from)),
          })
          .run();
        return;
      }
    }
    const dir = event.over?.data.current?.directory;
    if (
      typeof dir !== "string" ||
      from === dir ||
      dir.startsWith(`${from}/`) ||
      parentOf(from) === dir
    )
      return;
    if (
      ["Draft", "Research", "Trash"].some(
        (section) => from.toLowerCase() === `${root}/${section}`.toLowerCase(),
      )
    )
      return;
    const name = from.slice(from.lastIndexOf("/") + 1);
    void run(async () => {
      const to = `${dir}/${name}`;
      await moveEntry(from, to);
      setSelected((current) =>
        current?.path === from ? { ...current, path: to } : current,
      );
      useExplorerStore.getState().selectPath(to);
    });
  };

  const trashPath = binder?.trash?.path ?? (root ? `${root}/Trash` : null);
  const inTrash =
    !!menu &&
    !!trashPath &&
    (menu.node.path === trashPath ||
      menu.node.path.startsWith(`${trashPath}/`));
  const isBinderRoot =
    !!menu &&
    !!root &&
    ["Draft", "Research", "Trash"].some(
      (name) =>
        menu.node.path.toLowerCase() === `${root}/${name}`.toLowerCase(),
    );

  const deleteEntry = async (node: FileNode) => {
    if (
      !trashPath ||
      node.path.startsWith(`${trashPath}/`) ||
      node.path === trashPath
    )
      return;
    await moveEntry(node.path, `${trashPath}/${node.name}`);
    setMenu(null);
  };

  const ctx: TreeContext = {
    root,
    selected: selected?.path ?? null,
    editing,
    collapsed,
    onSelect: (node) => {
      setSelected(node);
      useExplorerStore.getState().selectPath(node.path);
    },
    onToggle: (path) =>
      setCollapsed((current) => {
        const next = new Map(current);
        next.set(path, !(current.get(path) ?? collapsedByDefault(path)));
        return next;
      }),
    onOpen: (path) => void run(() => openFile(path)),
    onSubmit: (name) => void onSubmit(name),
    onCancel: () => setEditing(null),
    onStartRename: (node) => {
      setSelected(node);
      useExplorerStore.getState().selectPath(node.path);
      setEditing(renameState(node));
    },
    onContextMenu: (node, x, y) => {
      setSelected(node);
      useExplorerStore.getState().selectPath(node.path);
      setMenu({ node, x, y });
    },
  };

  const creatingAtRoot =
    editing && editing.kind !== "rename" && editing.dir === root;

  return (
    <div className="p-3 text-sm">
      <div className="mb-2 flex flex-col gap-1.5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-white/50">
          {t("files.title")}
        </h2>
        <div className="flex items-center gap-1.5 text-xs">
          <button
            className={actionButton}
            title={t("files.newFileTitle")}
            disabled={!root}
            onClick={() => startCreate("new-file")}
          >
            {t("files.newFile")}
          </button>
          <button
            className={actionButton}
            title={t("files.newFolderTitle")}
            disabled={!root}
            onClick={() => startCreate("new-folder")}
          >
            {t("files.newFolder")}
          </button>
          <button
            className={`${actionButton} ml-auto px-1.5`}
            title={t("files.refresh")}
            aria-label={t("files.refresh")}
            disabled={!root}
            onClick={() => void run(refreshTree)}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21 12a9 9 0 1 1-2.64-6.36" />
              <path d="M21 3v6h-6" />
            </svg>
          </button>
        </div>
      </div>
      {error && (
        <div
          className="mb-2 flex items-start justify-between gap-1.5 rounded bg-red-950/40 p-1.5 text-xs text-red-400 border border-red-800/40"
          role="alert"
        >
          <p className="flex-1 break-words">{error}</p>
          <button
            type="button"
            className="text-red-400/70 hover:text-red-300 text-sm leading-none px-1 py-0.5 rounded transition-colors"
            aria-label="Dismiss error"
            title="Dismiss error"
            onClick={() => setError(null)}
          >
            ×
          </button>
        </div>
      )}
      {workspaceError && (
        <div
          className="mb-2 flex items-start justify-between gap-1.5 rounded bg-amber-950/40 p-1.5 text-xs text-amber-400 border border-amber-800/40"
          role="alert"
        >
          <p className="flex-1 break-words">{workspaceError}</p>
          <button
            type="button"
            className="text-amber-400/70 hover:text-amber-300 text-sm leading-none px-1 py-0.5 rounded transition-colors"
            aria-label="Dismiss error"
            title="Dismiss error"
            onClick={() => setWorkspaceError(null)}
          >
            ×
          </button>
        </div>
      )}
      <DndContext
        sensors={sensors}
        onDragEnd={onDragEnd}
        onDragStart={({ active }) =>
          setDraggedLabel(
            active.data.current?.label ??
              fileLabel(String(active.id).split("/").pop() ?? ""),
          )
        }
        onDragCancel={() => { setDraggedLabel(null); setImageCaret(null); }}
        onDragMove={(event) => {
          if (!isImageFile(String(event.active.id)) || !(event.activatorEvent instanceof MouseEvent)) {
            setImageCaret(null);
            return;
          }
          const target = findSnippetDropTarget(event.activatorEvent.clientX + event.delta.x, event.activatorEvent.clientY + event.delta.y);
          if (!target) { setImageCaret(null); return; }
          const point = target.editor.view.coordsAtPos(target.position);
          setImageCaret({ left: point.left, top: point.top, height: Math.max(18, point.bottom - point.top) });
        }}
        collisionDetection={(args) => {
          const collisions = pointerWithin(args);
          const rows = collisions.filter((hit) => hit.id !== root);
          return rows.length ? rows : collisions;
        }}
      >
        <RootDrop path={root}>
          {creatingAtRoot && (
            <li>
              <InlineInput
                placeholder={
                  editing.kind === "new-folder" ? "folder name" : "file name"
                }
                onSubmit={ctx.onSubmit}
                onCancel={ctx.onCancel}
              />
            </li>
          )}
          {nodes.map((n) => (
            <Node key={n.path} node={n} ctx={ctx} />
          ))}
        </RootDrop>
        {draggedLabel &&
          createPortal(
            <DragOverlay dropAnimation={null} style={{ pointerEvents: "none" }}>
              <div className="rounded border border-amber-400 bg-neutral-900 px-3 py-1 text-sm text-white shadow-lg">
                {draggedLabel}
              </div>
            </DragOverlay>,
            document.body,
          )}
      </DndContext>
      {imageCaret && createPortal(<div aria-hidden="true" data-image-drop-caret=""
        style={{ position: 'fixed', pointerEvents: 'none', zIndex: 1000, left: imageCaret.left,
          top: imageCaret.top, height: imageCaret.height, borderLeft: '3px solid #f59e0b' }} />, document.body)}
      {menu && (
        <div
          role="menu"
          aria-label={`${fileLabel(menu.node.name, menu.node.isDirectory)} actions`}
          className="fixed z-50 min-w-36 rounded border border-white/20 bg-neutral-800 p-1 shadow-xl"
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {menu.node.isDirectory ? (
            <button
              type="button"
              role="menuitem"
              className="block w-full rounded px-2 py-1 text-left hover:bg-white/10"
              onClick={() => {
                const path = menu.node.path;
                setMenu(null);
                void run(() => openFolder(path));
              }}
            >
              {t("files.openFolder")}
            </button>
          ) : (
            <button
              type="button"
              role="menuitem"
              className="block w-full rounded px-2 py-1 text-left hover:bg-white/10"
              onClick={() => {
                const path = menu.node.path;
                setMenu(null);
                void run(() => openFile(path));
              }}
            >
              {t("files.openFile")}
            </button>
          )}
          {!menu.node.isDirectory && (
            <button
              type="button"
              role="menuitem"
              className="block w-full rounded px-2 py-1 text-left hover:bg-white/10"
              onClick={() => {
                const path = menu.node.path;
                setMenu(null);
                void run(() => openFile(path, true));
              }}
            >
              {t("files.openInNewTab")}
            </button>
          )}
          {!menu.node.isDirectory && (
            <button
              type="button"
              role="menuitem"
              className="block w-full rounded px-2 py-1 text-left hover:bg-white/10"
              onClick={() => {
                const path = parentOf(menu.node.path);
                setMenu(null);
                void run(() => openFolder(path));
              }}
            >
              {t("files.openFolder")}
            </button>
          )}
          {!menu.node.isDirectory && (
            <button
              type="button"
              role="menuitem"
              className="block w-full rounded px-2 py-1 text-left hover:bg-white/10"
              onClick={() => {
                const path = menu.node.path;
                setMenu(null);
                void run(async () => {
                  if (!navigator.clipboard?.writeText) throw new Error("Clipboard is unavailable.");
                  await navigator.clipboard.writeText(path);
                });
              }}
            >
              {t("files.copyPath")}
            </button>
          )}
          {inTrash && !isBinderRoot && (
            <button
              type="button"
              role="menuitem"
              className="block w-full rounded px-2 py-1 text-left text-red-300 hover:bg-white/10"
              onClick={() => {
                setPendingDelete(menu.node);
                setMenu(null);
              }}
            >
              {t("files.deletePrompt")}
            </button>
          )}
          {!inTrash && !isBinderRoot && (
            <button
              type="button"
              role="menuitem"
              className="block w-full rounded px-2 py-1 text-left hover:bg-white/10"
              onClick={() => void run(() => deleteEntry(menu.node))}
            >
              {t("files.moveToTrash")}
            </button>
          )}
        </div>
      )}
      {pendingDelete && (
        <ConfirmDialog
          title={t("files.deletePermanently")}
          message={`Delete "${fileLabel(pendingDelete.name, pendingDelete.isDirectory)}"? It will be sent to the system recycle bin and removed from the project.`}
          confirmLabel={t("common.delete")}
          danger
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            const node = pendingDelete;
            setPendingDelete(null);
            void run(() => deleteFromTrash(node.path));
          }}
        />
      )}
      {!root && (
        <p className="text-xs text-white/40">{t("files.openFolderNotice")}</p>
      )}
    </div>
  );
}
