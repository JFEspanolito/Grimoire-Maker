import { create } from 'zustand'
import type { FileNode, Frontmatter, GrimoireDocument } from '../types/document'
import { parseDocument, serializeDocument } from '../lib/frontmatter'

interface DocumentState {
  document: GrimoireDocument
  workspaceRoot: string | null
  tree: FileNode[]
  setBody: (body: string) => void
  setFrontmatter: (patch: Partial<Frontmatter>) => void
  loadFromRaw: (path: string | null, raw: string) => void
  toRaw: () => string
  markSaved: (path: string) => void
  /** Re-points the open document after its file was renamed or moved; keeps the dirty flag. */
  setPath: (path: string) => void
  setWorkspace: (root: string | null, tree: FileNode[]) => void
}

export const useDocumentStore = create<DocumentState>((set, get) => ({
  document: {
    path: null,
    frontmatter: { title: 'Untitled Grimoire', pageSize: 'a4', columns: 2, theme: 'parchment' },
    body: '',
    dirty: false,
  },
  workspaceRoot: null,
  tree: [],
  setBody: (body) =>
    set((s) => (s.document.body === body ? s : { document: { ...s.document, body, dirty: true } })),
  setFrontmatter: (patch) =>
    set((s) => ({
      document: { ...s.document, frontmatter: { ...s.document.frontmatter, ...patch }, dirty: true },
    })),
  loadFromRaw: (path, raw) => {
    const { frontmatter, body } = parseDocument(raw)
    set({ document: { path, frontmatter, body, dirty: false } })
  },
  toRaw: () => {
    const { frontmatter, body } = get().document
    return serializeDocument(frontmatter, body)
  },
  markSaved: (path) => set((s) => ({ document: { ...s.document, path, dirty: false } })),
  setPath: (path) => set((s) => ({ document: { ...s.document, path } })),
  setWorkspace: (workspaceRoot, tree) => set({ workspaceRoot, tree }),
}))
