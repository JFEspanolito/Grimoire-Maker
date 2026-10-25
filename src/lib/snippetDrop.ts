import type { Editor } from '@tiptap/react'

const targets = new WeakMap<Element, Editor>()
const paths = new WeakMap<Element, string | null>()

/** Every mounted view owns its drop target, including the inactive split pane. */
export function registerSnippetDropTarget(editor: Editor, documentPath: string | null = null): () => void {
  const element = editor.view.dom
  targets.set(element, editor)
  paths.set(element, documentPath)
  return () => { if (targets.get(element) === editor) targets.delete(element) }
}

export function findSnippetDropTarget(x: number, y: number): { editor: Editor; position: number; documentPath: string | null } | null {
  const page = document.elementFromPoint(x, y)?.closest('.grimoire-page')
  const element = page?.querySelector<HTMLElement>('.ProseMirror')
  const editor = element && targets.get(element)
  if (!element || !editor || editor.isDestroyed || !editor.isEditable) return null
  const bounds = element.getBoundingClientRect()
  if (!bounds.width || !bounds.height) return null
  // Sheet margins and blank space below the document map to the nearest text edge.
  const hit = editor.view.posAtCoords({
    left: Math.max(bounds.left + 1, Math.min(bounds.right - 1, x)),
    top: Math.max(bounds.top + 1, Math.min(bounds.bottom - 1, y)),
  })
  return hit ? { editor, position: hit.pos, documentPath: paths.get(element) ?? null } : null
}
