import { createDocument, type Content, type Editor, type JSONContent } from '@tiptap/react'
import { Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import { closeHistory } from '@tiptap/pm/history'
import { dropPoint } from '@tiptap/pm/transform'

function isPlainTrailingBlock(node: PMNode | null | undefined): boolean {
  return !!node && node.type.name === 'paragraph' && node.content.size === 0
}

/** Ensures the caret can land in a plain paragraph after a trailing non-paragraph block (like a content box or table). */
export function focusDocumentEnd(editor: Editor): boolean {
  const { state, view } = editor
  const { doc, schema } = state
  const paragraph = schema.nodes.paragraph
  const lastTop = doc.lastChild
  if (!lastTop || !paragraph) {
    return editor.commands.focus('end', { scrollIntoView: false })
  }
  const container = lastTop.type.name === 'section' ? lastTop : doc
  const lastBlock = container.lastChild
  if (lastBlock && lastBlock.type.name !== 'paragraph' && !isPlainTrailingBlock(lastBlock)) {
    const insertPos = lastTop.type.name === 'section' ? doc.content.size - 1 : doc.content.size
    const tr = state.tr.insert(insertPos, paragraph.create())
    tr.setSelection(TextSelection.create(tr.doc, insertPos + 1))
    view.dispatch(tr)
    view.focus()
    return true
  }
  return editor.commands.focus('end', { scrollIntoView: false })
}

/** All document-producing plugins use this boundary; ordinary editor commands stay unchanged. */
export function insertContentBox(editor: Editor, content: Content, position?: number, attrs: Record<string, unknown> = {}): boolean {
  if (content === null) return false
  const markdown = (editor.storage as unknown as { markdown: { parser: { parse(value: string): string } } }).markdown
  const html = typeof content === 'string' ? markdown.parser.parse(content)
    : !Array.isArray(content) && content.type === 'doc' ? content
      : { type: 'doc', content: Array.isArray(content) ? content : [content] }
  const document = createDocument(html, editor.schema)
  // The page is made of sections; a box holds only the blocks inside them.
  const blocks = (document.toJSON().content as { type: string; content?: unknown[] }[]).flatMap((node) => node.type === 'section' ? node.content ?? [] : [node])
  const box = { type: 'standardContentBox', attrs, content: blocks as JSONContent[] }
  let insertion = position
  const resolved = editor.state.doc.resolve(position ?? editor.state.selection.from)
  // New groups are siblings, even when the caret/drop point is inside an existing group.
  // Otherwise free placement would anchor to a free parent instead of the page.
  for (let depth = resolved.depth; depth > 0; depth--) {
    if (resolved.node(depth).type.name === 'standardContentBox') insertion = resolved.after(depth)
  }
  return editor.chain().focus().command(({ tr }) => { closeHistory(tr); return true })
    .insertContentAt(insertion ?? editor.state.selection, box).run()
}

/** Reorder without changing placement, flattening children, or splitting a group. */
export function moveContentBox(editor: Editor, from: number, target: number): boolean {
  const node = editor.state.doc.nodeAt(from)
  if (node?.type.name !== 'standardContentBox') return false
  // Group boxes remain siblings rather than accidentally nesting when dropped on another box.
  const resolved = editor.state.doc.resolve(target)
  for (let depth = resolved.depth; depth > 0; depth--) {
    if (resolved.node(depth).type.name === 'standardContentBox') target = resolved.after(depth)
  }
  const destination = dropPoint(editor.state.doc, target, new Slice(Fragment.from(node), 0, 0))
  if (destination === null || (destination >= from && destination <= from + node.nodeSize)) return false
  const transaction = closeHistory(editor.state.tr).delete(from, from + node.nodeSize)
  const insertion = transaction.mapping.map(destination)
  transaction.insert(insertion, node).setSelection(NodeSelection.create(transaction.doc, insertion))
  editor.view.dispatch(transaction)
  return true
}
