import type { Editor } from '@tiptap/react'
import type { Node as PMNode } from '@tiptap/pm/model'

/** Blocks that can be saved whole when nothing is selected but the cursor sits inside one. */
const WHOLE_BLOCKS = new Set(['table', 'statblock', 'readAloud', 'characterSheet', 'standardContentBox'])

interface MarkdownStorage { serializer: { serialize(node: PMNode): string } }

function serialize(editor: Editor, doc: PMNode): string {
  const storage = (editor.storage as unknown as { markdown: MarkdownStorage }).markdown
  return storage.serializer.serialize(doc).trim()
}

/** Wraps one block in the page structure (doc > section) so the Markdown serializer can render it. */
function wrapBlock(editor: Editor, block: PMNode): PMNode {
  const { doc, section } = editor.schema.nodes
  return doc.create(null, section.create(null, block))
}

/**
 * Markdown of what a "save as snippet" action should keep: the selected slice of the page, or,
 * with a bare cursor inside a table, statblock, read-aloud, character sheet or content box, that
 * whole block. Uses the same serializer that writes the page body, so the result matches what
 * the document would save. Returns '' when there is nothing to save.
 */
export function selectionMarkdown(editor: Editor): string {
  const { from, to, empty, $from } = editor.state.selection
  if (!empty) return serialize(editor, editor.state.doc.cut(from, to))
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth)
    if (WHOLE_BLOCKS.has(node.type.name)) return serialize(editor, wrapBlock(editor, node))
  }
  return ''
}

/** True when a context-menu "save as snippet" has something to save. */
export function hasSnippetSelection(editor: Editor): boolean {
  return selectionMarkdown(editor).length > 0
}
