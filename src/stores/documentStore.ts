import { create } from 'zustand'
import type { FileNode, Frontmatter, GrimoireDocument } from '../types/document'
import { parseDocument, serializeDocument } from '../lib/frontmatter'
import { remapPath } from '../lib/binder'

interface DocumentState {
  restoringPaths: string[]
  beginRestore: (paths: string[]) => void
  endRestore: () => void
  restoreFromDisk: (path: string, raw: string) => void
  document: GrimoireDocument
  buffers: Record<string, GrimoireDocument>
  activate: (path: string) => void
  deactivate: () => void
  setBodyForPath: (path: string | null, body: string) => void
  setRawForPath: (path: string, raw: string) => void
  markSnapshotSaved: (path: string, snapshot: GrimoireDocument) => void
  remapDocuments: (from: string, to: string, transform?: (document: GrimoireDocument) => GrimoireDocument) => void
  forget: (path: string) => void
  resetDocuments: () => void
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

const emptyDocument = (): GrimoireDocument => ({ path: null, frontmatter: { title: 'Untitled Grimoire', pageSize: 'a4', columns: 2, theme: 'parchment' }, body: '', dirty: false })
const keyOf = (path: string | null) => path ?? '__untitled__'
export function isDocumentRestoring(state: Pick<DocumentState, 'restoringPaths'>, path: string | null): boolean {
  return path !== null && state.restoringPaths.some((scope) => path === scope || path.startsWith(`${scope}/`))
}
function updateDocument(state: DocumentState, document: GrimoireDocument) {
  return { buffers: { ...state.buffers, [keyOf(document.path)]: document }, ...(state.document.path === document.path ? { document } : {}) }
}

export const useDocumentStore = create<DocumentState>((set, get) => ({
  restoringPaths: [],
  beginRestore: (restoringPaths) => {
    const state = get()
    const affected = { restoringPaths }
    const dirty = Object.values({ ...state.buffers, [keyOf(state.document.path)]: state.document })
      .find((document) => document.dirty && isDocumentRestoring(affected, document.path))
    if (dirty) throw new Error(`Save unsaved changes in ${dirty.path} before restoring files.`)
    set({ restoringPaths })
  },
  endRestore: () => set({ restoringPaths: [] }),
  restoreFromDisk: (path, raw) => set((state) => updateDocument(state, { path, ...parseDocument(raw), dirty: false })),
  buffers: {},
  resetDocuments: () => set({ document: emptyDocument(), buffers: {}, restoringPaths: [] }),
  deactivate: () => set((state) => ({ document: emptyDocument(), buffers: {
    ...state.buffers, ...(state.document.path ? { [state.document.path]: state.document } : {}),
  } })),
  activate: (path) => set((state) => state.buffers[path] ? { document: state.buffers[path] } : {}),
  forget: (path) => set((state) => {
    const buffers = { ...state.buffers }
    delete buffers[path]
    return { buffers, ...(state.document.path === path ? { document: emptyDocument() } : {}) }
  }),
  setBodyForPath: (path, body) => set((state) => {
    if (isDocumentRestoring(state, path)) return state
    const current = state.document.path === path ? state.document : state.buffers[keyOf(path)]
    if (!current || current.body === body) return state
    return updateDocument(state, { ...current, body, dirty: true })
  }),
  setRawForPath: (path, raw) => set((state) => {
    if (isDocumentRestoring(state, path)) return state
    const current = state.document.path === path ? state.document : state.buffers[path]
    if (!current || serializeDocument(current.frontmatter, current.body) === raw) return state
    return updateDocument(state, { ...current, ...parseDocument(raw), dirty: true })
  }),
  markSnapshotSaved: (path, snapshot) => set((state) => {
    const current = state.document.path === snapshot.path ? state.document : state.buffers[keyOf(snapshot.path)]
    if (!current) return state
    const document = { ...current, path, dirty: current.body !== snapshot.body || current.frontmatter !== snapshot.frontmatter }
    const buffers = { ...state.buffers }
    delete buffers[keyOf(snapshot.path)]
    buffers[path] = document
    return { buffers, ...(state.document.path === snapshot.path ? { document } : {}) }
  }),
  remapDocuments: (from, to, transform) => set((state) => {
    const buffers: Record<string, GrimoireDocument> = {}
    for (const current of Object.values({ ...state.buffers, [keyOf(state.document.path)]: state.document })) {
      const path = remapPath(current.path, from, to)
      buffers[keyOf(path)] = { ...(transform ? transform(current) : current), path }
    }
    return { buffers, document: buffers[keyOf(remapPath(state.document.path, from, to))] }
  }),
  document: {
    path: null,
    frontmatter: { title: 'Untitled Grimoire', pageSize: 'a4', columns: 2, theme: 'parchment' },
    body: '',
    dirty: false,
  },
  workspaceRoot: null,
  tree: [],
  setBody: (body) => get().setBodyForPath(get().document.path, body),
  setFrontmatter: (patch) =>
    set((s) => isDocumentRestoring(s, s.document.path) ? s : updateDocument(s, { ...s.document, frontmatter: { ...s.document.frontmatter, ...patch }, dirty: true })),
  loadFromRaw: (path, raw) => {
    const { frontmatter, body } = parseDocument(raw)
    const document = { path, frontmatter, body, dirty: false }
    set((state) => ({ document, buffers: { ...state.buffers, [keyOf(state.document.path)]: state.document, [keyOf(path)]: document } }))
  },
  toRaw: () => {
    const { frontmatter, body } = get().document
    return serializeDocument(frontmatter, body)
  },
  markSaved: (path) => get().markSnapshotSaved(path, get().document),
  setPath: (path) => {
    const old = get().document.path
    if (old) get().remapDocuments(old, path)
    else set((s) => ({ document: { ...s.document, path }, buffers: { ...s.buffers, [path]: { ...s.document, path } } }))
  },
  setWorkspace: (workspaceRoot, tree) => set({ workspaceRoot, tree }),
}))
