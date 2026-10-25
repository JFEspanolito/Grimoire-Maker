import { readTextFile } from '@tauri-apps/plugin-fs'
import { renderDocumentHtml } from '../components/editor/renderDocumentContent'
import { printableContent } from './exportPdf'
import { parseDocument } from './frontmatter'
import { useDocumentStore } from '../stores/documentStore'

/** The newest text of a document: unsaved edits win over what is on disk. */
async function markdownOf(path: string): Promise<string> {
  const { document, buffers } = useDocumentStore.getState()
  const open = document.path === path ? document : buffers[path]
  return open ? open.body : parseDocument(await readTextFile(path)).body
}

/** Printable content for each of the project's documents, in book order (paths relative to `root`). */
export async function loadBookContents(root: string, relativePaths: string[], columns: number): Promise<HTMLElement[]> {
  const base = root.replaceAll('\\', '/').replace(/\/+$/, '')
  const contents: HTMLElement[] = []
  for (const relative of relativePaths) {
    const path = `${base}/${relative}`
    contents.push(printableContent(await renderDocumentHtml(await markdownOf(path), path), columns))
  }
  return contents
}
