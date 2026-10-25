import type { FileNode } from '../types/document'

/** The binder sections are plain folders at the workspace root, so projects stay ordinary files. */
export const BINDER_FOLDERS = ['Draft', 'Research', 'Assets', 'Trash'] as const
export type BinderSection = (typeof BINDER_FOLDERS)[number]

export interface BinderView {
  draft: FileNode | null
  research: FileNode | null
  assets: FileNode | null
  trash: FileNode | null
  /** Everything else at the workspace root. */
  other: FileNode[]
}

/**
 * Splits the workspace tree into binder sections. Returns null when the folder has none
 * of them, so an ordinary folder keeps its plain tree. Names are matched without regard
 * to case because the filesystem (Windows, macOS) does the same.
 */
export function splitBinder(tree: FileNode[]): BinderView | null {
  const view: BinderView = { draft: null, research: null, assets: null, trash: null, other: [] }
  const keys: Record<string, 'draft' | 'research' | 'assets' | 'trash'> = {
    draft: 'draft',
    research: 'research',
    assets: 'assets',
    trash: 'trash',
  }
  for (const node of tree) {
    const key = node.isDirectory ? keys[node.name.toLowerCase()] : undefined
    if (key && view[key] === null) view[key] = node
    else view.other.push(node)
  }
  return view.draft || view.research || view.assets || view.trash ? view : null
}

export interface BinderFs {
  exists(path: string): Promise<boolean>
  mkdir(path: string): Promise<void>
}

/** Creates the sections that are missing and returns their names. Existing folders are left alone. */
export async function setupBinder(fs: BinderFs, root: string): Promise<BinderSection[]> {
  const created: BinderSection[] = []
  for (const name of BINDER_FOLDERS) {
    const path = `${root}/${name}`
    if (await fs.exists(path)) continue
    await fs.mkdir(path)
    created.push(name)
  }
  return created
}

/** Where a path ends up after `from` was moved to `to`; unrelated paths are unchanged. */
export function remapPath(current: string | null, from: string, to: string): string | null {
  if (current === null) return null
  if (current === from) return to
  return current.startsWith(`${from}/`) ? to + current.slice(from.length) : current
}

/** Folder-name fallback for projects without an explicit book display name. */
export function projectName(root: string | null): string {
  return root?.replaceAll('\\', '/').replace(/\/+$/, '').split('/').pop() || 'No project'
}
