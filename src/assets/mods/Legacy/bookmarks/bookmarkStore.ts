import { create } from 'zustand'
import { getWorkspaceRoot, readProjectData, writeProjectData } from '@grimoire/plugin-api'
import type { BlockAnchor } from './anchors'

export const PLUGIN_ID = 'builtin.bookmarks'
const MAX_BOOKMARKS = 1000

export interface Bookmark extends BlockAnchor { id: string; path: string }
export interface MenuState { x: number; y: number; path: string; anchor: BlockAnchor }

interface BookmarkState {
  root: string | null
  items: Bookmark[]
  error: string
  menu: MenuState | null
  load(root: string): Promise<void>
  add(path: string, anchor: BlockAnchor): void
  remove(id: string): void
  openMenu(menu: MenuState): void
  closeMenu(): void
}

/** Paths are saved relative to the project so the folder can be moved or shared. */
export const toRelative = (root: string, path: string) => path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path
export const toAbsolute = (root: string, path: string) => /^([A-Za-z]:)?\//.test(path) ? path : `${root}/${path}`

function parse(text: string): Bookmark[] {
  const value: unknown = JSON.parse(text)
  const list = value && typeof value === 'object' && 'items' in value && Array.isArray(value.items) ? value.items : []
  return list.filter((item): item is Bookmark => !!item && typeof item === 'object'
    && typeof item.id === 'string' && typeof item.path === 'string' && typeof item.excerpt === 'string'
    && Number.isInteger(item.index)).slice(0, MAX_BOOKMARKS)
}

let saving: Promise<unknown> = Promise.resolve()

export const useBookmarks = create<BookmarkState>((set, get) => {
  /** Saves in order, so a slow earlier write can never overwrite a newer list. */
  const persist = () => {
    const { root, items } = get()
    if (!root) return
    saving = saving.then(() => writeProjectData(root, PLUGIN_ID, JSON.stringify({ version: 1, items }, null, 2)))
      .then(() => { if (get().error) set({ error: '' }) })
      .catch((error: unknown) => set({ error: `Could not save bookmarks: ${error instanceof Error ? error.message : String(error)}` }))
  }
  return {
    root: null, items: [], error: '', menu: null,
    load: async (root) => {
      set({ root, items: [], error: '' })
      try {
        const text = await readProjectData(root, PLUGIN_ID)
        // A late read for a project that is no longer open must not replace the current list.
        if (get().root === root) set({ items: text ? parse(text) : [] })
      } catch (error) {
        if (get().root === root) set({ error: `Could not read bookmarks: ${error instanceof Error ? error.message : String(error)}` })
      }
    },
    add: (path, anchor) => {
      const root = get().root ?? getWorkspaceRoot()
      if (!root || get().items.length >= MAX_BOOKMARKS) return
      if (!get().root) set({ root })
      const relative = toRelative(root, path)
      const exists = get().items.some(item => item.path === relative && item.index === anchor.index && item.excerpt === anchor.excerpt)
      if (!exists) set(state => ({ items: [...state.items, { id: crypto.randomUUID(), path: relative, ...anchor }] }))
      persist()
    },
    remove: (id) => { set(state => ({ items: state.items.filter(item => item.id !== id) })); persist() },
    openMenu: (menu) => set({ menu }),
    closeMenu: () => set({ menu: null }),
  }
})
