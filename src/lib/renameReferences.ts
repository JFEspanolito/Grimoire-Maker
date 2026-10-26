import { invoke } from '@tauri-apps/api/core'
import type { GrimoireDocument } from '../types/document'
import { parseDocument } from './frontmatter'
import { rewriteMarkdownReferences } from './markdownReferences'

interface RenameDocument { path: string; before: string }
interface RenameSnapshot { documents: RenameDocument[] }
const key = (path: string) => path.replaceAll('\\', '/').toLowerCase()

/** Disk uses saved bytes only. The returned transform applies to the latest live buffers. */
export async function renameProjectFile(root: string, from: string, to: string): Promise<(document: GrimoireDocument) => GrimoireDocument> {
  const snapshot = await invoke<RenameSnapshot>('snapshot_rename_references', { root, from, to })
  const documents = snapshot.documents.map(document => ({
    ...document,
    after: rewriteMarkdownReferences(document.before, document.path, from, to),
  }))
  const originals = new Map(documents.map(document => [key(document.path), parseDocument(document.before)]))
  await invoke('commit_rename_references', { root, from, to, documents })
  return document => {
    if (!document.path || !key(document.path).startsWith(`${key(root).replace(/\/$/, '')}/`)
      || !/\.md$/i.test(document.path)) return document
    const body = rewriteMarkdownReferences(document.body, document.path, from, to)
    const saved = originals.get(key(document.path))
    // Never mark newer typing or an externally stale buffer as saved by this operation.
    const matchesDisk = saved && saved.body === document.body
      && JSON.stringify(saved.frontmatter) === JSON.stringify(document.frontmatter)
    return { ...document, body, dirty: document.dirty || !matchesDisk }
  }
}
