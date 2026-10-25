import type { Editor } from '@tiptap/react'
import { useDocumentStore } from '../stores/documentStore'
import { importImage } from './images'

/** Content that the Insert menu adds at the caret of the active editor. */
export const insertQuote = (editor: Editor) => editor.chain().focus().toggleBlockquote().run()
export const insertDivider = (editor: Editor) => editor.chain().focus().setHorizontalRule().run()
export const insertTable = (editor: Editor) => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()

/** Copies a picked image next to the document and inserts it. Throws a user-readable error. */
export async function insertImage(editor: Editor) {
  const documentPath = useDocumentStore.getState().document.path
  if (!documentPath) {
    throw new Error('Save this document as Markdown before importing an image. Then choose Insert → Image to pick a PNG, JPG, GIF, WebP, or SVG file.')
  }
  const src = await importImage(documentPath, useDocumentStore.getState().workspaceRoot)
  if (src && !editor.isDestroyed) editor.chain().focus().setImage({ src, alt: '' }).run()
}
