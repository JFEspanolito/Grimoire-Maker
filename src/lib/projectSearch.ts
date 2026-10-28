import type { Editor } from '@tiptap/react'
import { findMatches } from '../components/editor/extensions/searchHighlight'
import { useDocumentStore } from '../stores/documentStore'
import type { FileNode, GrimoireDocument } from '../types/document'
import { splitBinder } from './binder'
import { parseDocument } from './frontmatter'
import { commitProjectReplace, snapshotProjectTexts, type ProjectChange } from './projectReplace'
import { findInText, MAX_MATCHES, replaceInText, type SearchOptions, type TextMatch } from './searchReplace'

/** One project document as the search sees it: the open buffer when there is one, else the file on disk. */
export interface ProjectDocument {
  path: string
  open: boolean
  /** Markdown body (never the frontmatter). */
  body: string
  /** Closed documents only: the file text read at search time, and the path as the snapshot spelled it. */
  raw?: string
  snapshotPath?: string
}

export interface ProjectMatch extends TextMatch {
  id: string
  path: string
  /** Position among this file's matches; replace-by-index and the editor jump both use it. */
  index: number
}
export interface FileResult { path: string; open: boolean; matches: ProjectMatch[] }
export interface ProjectSearch {
  docs: ProjectDocument[]
  knownPaths?: string[]
  files: FileResult[]
  total: number
  truncated: boolean
  error?: string
}

const normalize = (path: string) => path.replaceAll('\\', '/')
const keyOf = (path: string) => normalize(path).toLowerCase()
const absolute = (root: string, path: string) => /^(?:[a-z]:)?\//i.test(normalize(path)) ? normalize(path) : `${normalize(root).replace(/\/+$/, '')}/${normalize(path)}`

/** Draft, Research and the loose folders of the project; never Trash, Assets or hidden folders. */
export function projectMarkdownPaths(tree: FileNode[]): string[] {
  const view = splitBinder(tree)
  const roots = view ? [view.draft, view.research, ...view.other].filter((node): node is FileNode => node !== null) : tree
  const collect = (nodes: FileNode[]): string[] => nodes.flatMap((node) => {
    if (node.name.startsWith('.')) return []
    if (node.isDirectory) return collect(node.children ?? [])
    return /\.md$/i.test(node.name) ? [normalize(node.path)] : []
  })
  return collect(roots)
}

/** Reads every project document; open documents come from memory so unsaved edits are searched. */
export async function loadProjectDocuments(root: string): Promise<{ docs: ProjectDocument[]; knownPaths?: string[] }> {
  const state = useDocumentStore.getState()
  const paths = projectMarkdownPaths(state.tree)
  const open = new Map<string, GrimoireDocument>()
  for (const document of [...Object.values(state.buffers), state.document]) if (document.path) open.set(keyOf(document.path), document)
  const snapshot = paths.some((path) => !open.has(keyOf(path))) ? await snapshotProjectTexts(root) : null
  const disk = new Map((snapshot ?? []).map((entry) => [keyOf(absolute(root, entry.path)), entry]))
  const docs: ProjectDocument[] = []
  for (const path of paths) {
    const buffer = open.get(keyOf(path))
    const entry = disk.get(keyOf(path))
    if (buffer) docs.push({ path, open: true, body: buffer.body })
    else if (entry) docs.push({ path, open: false, body: parseDocument(entry.before).body, raw: entry.before, snapshotPath: entry.path })
  }
  return { docs, knownPaths: snapshot?.map((entry) => entry.path) }
}

/** Searches loaded documents. Links, image paths, HTML tags and URLs are never matched. */
export function searchDocuments(docs: ProjectDocument[], query: SearchOptions): Omit<ProjectSearch, 'docs' | 'knownPaths'> {
  const files: FileResult[] = []
  let total = 0
  let truncated = false
  for (const doc of docs) {
    const found = findInText(doc.body, query, { protect: true })
    if (found.error) return { files: [], total: 0, truncated: false, error: found.error }
    if (!found.matches.length) continue
    const room = MAX_MATCHES - total
    const kept = found.matches.slice(0, room)
    files.push({ path: doc.path, open: doc.open, matches: kept.map((match, index) => ({ ...match, id: `${doc.path}:${match.start}`, path: doc.path, index })) })
    total += kept.length
    if (found.truncated || kept.length < found.matches.length) { truncated = true; break }
  }
  return { files, total, truncated }
}

export async function searchProject(root: string, query: SearchOptions): Promise<ProjectSearch> {
  const loaded = await loadProjectDocuments(root)
  return { ...loaded, ...searchDocuments(loaded.docs, query) }
}

/** The shape of what a replace changed, kept in memory for `Undo last replace`. */
export interface AppliedChange {
  path: string
  /** `file`: whole file text on disk. `buffer`: the Markdown body of an open document. */
  kind: 'file' | 'buffer'
  before: string
  after: string
  snapshotPath?: string
}

/** Thrown when the documents changed after the search; nothing was replaced. */
export class ProjectChangedError extends Error {}

const currentDocument = (path: string): GrimoireDocument | undefined => {
  const state = useDocumentStore.getState()
  return [...Object.values(state.buffers), state.document].find((document) => document.path && keyOf(document.path) === keyOf(path))
}

/**
 * Replaces the selected matches. Closed files are written as a single all-or-nothing commit first; open
 * documents then change in their buffers (dirty, saved by autosave). The frontmatter bytes are never touched.
 */
export async function applyProjectReplace(root: string, search: ProjectSearch, query: SearchOptions, replacement: string, selected: ReadonlySet<string>): Promise<{ changes: AppliedChange[]; matches: number }> {
  const changes: AppliedChange[] = []
  const buffers: { path: string; after: string }[] = []
  let matches = 0
  for (const file of search.files) {
    const indexes = file.matches.filter((match) => selected.has(match.id)).map((match) => match.index)
    const doc = search.docs.find((candidate) => candidate.path === file.path)
    if (!indexes.length || !doc) continue
    const body = replaceInText(doc.body, query, replacement, indexes, { protect: true })
    if (body === doc.body) continue
    matches += indexes.length
    if (doc.open) {
      if (currentDocument(doc.path)?.body !== doc.body) throw new ProjectChangedError('A document changed since the search, so nothing was replaced. The search was run again.')
      changes.push({ path: doc.path, kind: 'buffer', before: doc.body, after: body })
      buffers.push({ path: doc.path, after: body })
    } else if (doc.raw !== undefined && doc.snapshotPath !== undefined) {
      // Splice the body only: the frontmatter keeps its exact bytes.
      const head = doc.raw.slice(0, doc.raw.length - doc.body.length)
      changes.push({ path: doc.path, kind: 'file', before: doc.raw, after: head + body, snapshotPath: doc.snapshotPath })
    }
  }
  const files = changes.filter((change) => change.kind === 'file')
  if (files.length) {
    const payload: ProjectChange[] = files.map((change) => ({ path: change.snapshotPath!, before: change.before, after: change.after }))
    try { await commitProjectReplace(root, payload, search.knownPaths) } catch {
      throw new ProjectChangedError('Some files changed on disk since the search, so nothing was replaced. The search was run again.')
    }
  }
  for (const buffer of buffers) useDocumentStore.getState().setBodyForPath(buffer.path, buffer.after)
  return { changes, matches }
}

/** Puts the previous contents back where nothing changed since. Returns the files it had to skip. */
export async function undoProjectReplace(root: string, applied: AppliedChange[]): Promise<{ restored: number; skipped: string[] }> {
  const skipped: string[] = []
  const disk: AppliedChange[] = []
  let restored = 0
  for (const change of applied) {
    const open = currentDocument(change.path)
    if (open) {
      const after = change.kind === 'buffer' ? change.after : parseDocument(change.after).body
      const before = change.kind === 'buffer' ? change.before : parseDocument(change.before).body
      if (open.body === after) { useDocumentStore.getState().setBodyForPath(change.path, before); restored++ } else skipped.push(change.path)
    } else if (change.kind === 'file') disk.push(change)
    else skipped.push(change.path)
  }
  if (disk.length) {
    try {
      // A fresh snapshot right before: a file added or removed since rejects the commit.
      const knownPaths = (await snapshotProjectTexts(root)).map((entry) => entry.path)
      await commitProjectReplace(root, disk.map((change) => ({ path: change.snapshotPath!, before: change.after, after: change.before })), knownPaths)
      restored += disk.length
    } catch { skipped.push(...disk.map((change) => change.path)) }
  }
  return { restored, skipped }
}

/**
 * Selects a project match in the editor that shows its file. The Markdown source cannot be mapped to the
 * editor text exactly, so the match is found by its position among the file's matches and checked against
 * the matched text; when that check fails the first occurrence of the same text is used instead.
 */
export function selectInEditor(editor: Editor, query: SearchOptions, match: ProjectMatch, matchedText: string): boolean {
  const candidates = findMatches(editor.state.doc, query)
  const textOf = (range: { from: number; to: number }) => editor.state.doc.textBetween(range.from, range.to, undefined, '￼').toLowerCase()
  const wanted = matchedText.toLowerCase()
  const target = (candidates[match.index] && textOf(candidates[match.index]) === wanted ? candidates[match.index] : undefined)
    ?? candidates.find((candidate) => textOf(candidate) === wanted) ?? candidates[match.index] ?? candidates[0]
  if (!target) return false
  editor.chain().focus().setTextSelection(target).scrollIntoView().run()
  return true
}
