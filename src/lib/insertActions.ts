import type { Editor } from '@tiptap/react'
import { useDocumentStore } from '../stores/documentStore'
import { useFormulaStore, type FormulaDisplay } from '../stores/formulaStore'
import { useSettingsStore } from '../stores/settingsStore'
import { PAGE_SIZES } from '../types/document'
import { insertContentBox } from './contentBoxes'
import { importImage } from './images'

/** Content that the Insert menu adds at the caret of the active editor. */
export const insertQuote = (editor: Editor) => editor.chain().focus().toggleBlockquote().run()
export const insertDivider = (editor: Editor) => editor.chain().focus().setHorizontalRule().run()
export const insertSectionBreak = (editor: Editor) => editor.chain().focus().insertSectionBreak().run()
export const insertTable = (editor: Editor) => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()

/** Opens the mathematical formula builder for the active editor. */
export function insertFormula(editor: Editor) {
  useFormulaStore.getState().show(editor)
}

/** Inserts a new `mathFormula` node at the caret, or updates the existing formula at `editPos`. */
export function applyFormula(editor: Editor, latex: string, display: FormulaDisplay = 'block', editPos: number | null = null) {
  if (editor.isDestroyed) return false
  if (editPos !== null && editor.state.doc.nodeAt(editPos)?.type.name === 'mathFormula') {
    return editor.chain().focus().setNodeSelection(editPos).updateAttributes('mathFormula', { latex, display }).run()
  }
  return editor.chain().focus().insertContent({ type: 'mathFormula', attrs: { latex, display } }).run()
}

/**
 * A box of its own: 2 px black border, free to drag anywhere on the page. It starts beside the caret,
 * at the page's left margin, so it is visible where the author is working.
 */
export function insertFloatingBox(editor: Editor) {
  const { pageSize, marginMm } = useSettingsStore.getState()
  const page = editor.view.dom.closest('.grimoire-page')
  const sheet = page?.getBoundingClientRect()
  const scale = sheet && sheet.width ? sheet.width / PAGE_SIZES[pageSize].widthMm : 0
  const caret = scale ? editor.view.coordsAtPos(editor.state.selection.from).top : null
  const yMm = caret !== null && sheet ? Math.max(0, (caret - sheet.top) / scale) : marginMm
  return insertContentBox(editor, { type: 'paragraph' }, undefined, {
    placement: 'free', widthMm: 60, xMm: marginMm, yMm: Math.round(yMm * 10) / 10, borderWidth: 2, borderColor: '#000000',
  })
}

/** Layout every newly placed image starts with; the image controls change it afterwards. */
export function newImageAttrs(src: string) {
  const file = src.split('/').pop() ?? ''
  const dot = file.lastIndexOf('.')
  return { src, alt: dot > 0 ? file.slice(0, dot) : file, align: 'center', widthMm: 55, frame: 'shadow', opacity: 1, anchor: 'flow' }
}

/** Copies a picked image next to the document and inserts it. Throws a user-readable error. */
export async function insertImage(editor: Editor) {
  const documentPath = useDocumentStore.getState().document.path
  if (!documentPath) {
    throw new Error('Save this document as Markdown before importing an image. Then choose Insert → Image to pick a PNG, JPG, GIF, WebP, or SVG file.')
  }
  const src = await importImage(documentPath, useDocumentStore.getState().workspaceRoot)
  if (src && !editor.isDestroyed) editor.chain().focus().insertContent({ type: 'image', attrs: newImageAttrs(src) }).run()
}
