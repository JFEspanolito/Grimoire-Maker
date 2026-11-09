import { Fragment, type Node as PMNode } from '@tiptap/pm/model'
import { Selection, type EditorState } from '@tiptap/pm/state'
import { Extension, getHTMLFromFragment, type Editor } from '@tiptap/react'
import { findTable, toggleColumnSpan } from '../TableControls'

export const INDENT_STEP_EM = 2
export const MAX_INDENT = 6

const blockAttributes = {
  indent: {
    default: 0,
    parseHTML: (element: HTMLElement) => Math.min(MAX_INDENT, Math.max(0, Number(element.getAttribute('data-indent')) || 0)),
    renderHTML: (attributes: Record<string, unknown>) => attributes.indent
      ? { 'data-indent': String(attributes.indent), style: `margin-left: ${Number(attributes.indent) * INDENT_STEP_EM}em` }
      : {},
  },
  columnSpan: {
    default: null,
    parseHTML: (element: HTMLElement) => (element.getAttribute('data-column-span') === 'all' || element.style.columnSpan === 'all' ? 'all' : null),
    renderHTML: (attributes: Record<string, unknown>) => attributes.columnSpan === 'all'
      ? { 'data-column-span': 'all', style: 'column-span: all;' }
      : {},
  },
}

export function isBlockColumnSpanned(editor: Editor): boolean {
  if (editor.isActive('table')) {
    const table = findTable(editor)
    return table?.node.attrs.columnSpan === 'all'
  }
  const { selection } = editor.state
  if ('node' in selection) {
    const selNode = (selection as { node?: PMNode }).node
    if (selNode && selNode.attrs.columnSpan !== undefined) {
      return selNode.attrs.columnSpan === 'all'
    }
  }
  const { $from } = selection
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d)
    if (node.attrs.columnSpan !== undefined) {
      return node.attrs.columnSpan === 'all'
    }
  }
  return false
}

export function toggleBlockColumnSpan(editor: Editor): boolean {
  if (editor.isActive('table')) {
    return toggleColumnSpan(editor)
  }

  const { state, view } = editor
  const { doc, selection } = state
  const { from, to } = selection

  const targets: { pos: number; node: PMNode }[] = []

  // Check if current selection is a NodeSelection (e.g. horizontalRule or image)
  if ('node' in selection) {
    const selNode = (selection as { node?: PMNode }).node
    if (selNode && selNode.attrs.columnSpan !== undefined) {
      targets.push({ pos: selection.from, node: selNode })
    }
  }

  if (targets.length === 0) {
    doc.nodesBetween(from, to, (node, pos, parent) => {
      if (node.attrs.columnSpan !== undefined && (node.type.name === 'heading' || node.type.name === 'paragraph' || node.type.name === 'blockquote' || node.type.name === 'horizontalRule')) {
        targets.push({ pos, node })
        return false
      }
      return true
    })
  }

  if (targets.length === 0) {
    const { $from } = selection
    for (let d = $from.depth; d > 0; d--) {
      const node = $from.node(d)
      if (node.attrs.columnSpan !== undefined && (node.type.name === 'heading' || node.type.name === 'paragraph' || node.type.name === 'blockquote' || node.type.name === 'horizontalRule')) {
        targets.push({ pos: $from.before(d), node })
        break
      }
    }
  }

  if (targets.length === 0) return false

  const allSpanned = targets.every(({ node }) => node.attrs.columnSpan === 'all')
  const nextSpan = allSpanned ? null : 'all'

  let tr = state.tr
  for (const { pos, node } of targets) {
    tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, columnSpan: nextSpan })
  }

  view.dispatch(tr)
  return true
}

interface SerializerState {
  write(text: string): void
  closeBlock(node: PMNode): void
  renderInline(node: PMNode, escape?: boolean): void
  repeat(text: string, count: number): string
}

/** Plain Markdown cannot carry alignment, indentation, or column span, so only those blocks are written as HTML. */
const isFormatted = (node: PMNode) => (node.attrs.textAlign && node.attrs.textAlign !== 'left') || node.attrs.indent > 0 || node.attrs.columnSpan === 'all'

function writeHtml(state: SerializerState, node: PMNode) {
  state.write(getHTMLFromFragment(Fragment.from(node), node.type.schema))
  state.closeBlock(node)
}

declare module '@tiptap/react' {
  interface Commands<ReturnType> {
    blockFormat: {
      toggleBlockColumnSpan: () => ReturnType
    }
  }
}

/** Paragraph that remembers its indent and keeps alignment, indent and column span when saved as Markdown. */
/**
 * StarterKit owns the paragraph and heading nodes, so this adds the indent and columnSpan attributes globally and
 * replaces their Markdown serializers once the editor exists (the serializer reads them lazily).
 */
export const BlockFormat = Extension.create({
  name: 'blockFormat',
  addGlobalAttributes() {
    return [{ types: ['paragraph', 'heading', 'blockquote', 'horizontalRule'], attributes: blockAttributes }]
  },
  addCommands() {
    return {
      toggleBlockColumnSpan: () => ({ editor }) => toggleBlockColumnSpan(editor),
    }
  },
  onBeforeCreate() {
    const nodes = this.editor.extensionManager.extensions
    const serializers: Record<string, (state: SerializerState, node: PMNode) => void> = {
      paragraph(state, node) {
        if (isFormatted(node)) return writeHtml(state, node)
        state.renderInline(node)
        state.closeBlock(node)
      },
      heading(state, node) {
        if (isFormatted(node)) return writeHtml(state, node)
        state.write(`${state.repeat('#', node.attrs.level)} `)
        state.renderInline(node, false)
        state.closeBlock(node)
      },
      blockquote(state, node) {
        if (isFormatted(node)) return writeHtml(state, node)
        state.wrapIn('> ', () => state.renderContent(node))
      },
      horizontalRule(state, node) {
        if (isFormatted(node)) return writeHtml(state, node)
        state.write('---')
        state.closeBlock(node)
      },
    }
    for (const [name, serialize] of Object.entries(serializers)) {
      const extension = nodes.find((candidate) => candidate.name === name)
      // `storage` is rebuilt from `addStorage` on every read, so the override has to live there.
      if (extension) (extension.config as { addStorage?: () => unknown }).addStorage = () => ({ markdown: { serialize, parse: {} } })
    }
  },
  addKeyboardShortcuts() {
    return {
      'Alt-c': () => toggleBlockColumnSpan(this.editor),
      Tab: () => {
        if (this.editor.isActive('listItem')) {
          if (this.editor.can().sinkListItem('listItem')) {
            return this.editor.commands.sinkListItem('listItem')
          }
          return sinkListIntoPrevious(this.editor)
        }
        return false
      },
    }
  },
})

export function findEnclosingList(state: EditorState) {
  const { $from } = state.selection
  for (let d = $from.depth; d > 0; d--) {
    const name = $from.node(d).type.name
    if (name === 'bulletList' || name === 'orderedList') {
      return { node: $from.node(d), depth: d, pos: $from.before(d) }
    }
  }
  return null
}

export function canSinkListIntoPrevious(state: EditorState): boolean {
  const currentList = findEnclosingList(state)
  if (!currentList) return false
  const $listPos = state.doc.resolve(currentList.pos)
  const prevNode = $listPos.nodeBefore
  if (!prevNode) return false
  return prevNode.type.name === 'orderedList' || prevNode.type.name === 'bulletList'
}

export function sinkListIntoPrevious(editor: any): boolean {
  const state: EditorState | undefined = editor.state
  if (!state) return false
  const currentList = findEnclosingList(state)
  if (!currentList) return false
  const $listPos = state.doc.resolve(currentList.pos)
  const prevNode = $listPos.nodeBefore
  if (!prevNode || (prevNode.type.name !== 'orderedList' && prevNode.type.name !== 'bulletList')) return false

  const listNode = currentList.node
  const listSize = listNode.nodeSize
  const relativeCursorPos = state.selection.from - currentList.pos

  const tr = state.tr
  // Inside the last listItem of prevNode:
  const insideLastItemPos = currentList.pos - 2

  tr.delete(currentList.pos, currentList.pos + listSize)
  tr.insert(insideLastItemPos, listNode)
  const newCursorPos = insideLastItemPos + relativeCursorPos
  try {
    tr.setSelection(Selection.near(tr.doc.resolve(newCursorPos)))
  } catch {
    // Keep fallback selection if pos boundary shifted
  }
  if (editor.view?.dispatch) {
    editor.view.dispatch(tr)
  }
  return true
}

export function getPreviousOrderedList(state: EditorState): { node: PMNode; pos: number } | null {
  const { doc, selection } = state
  let prevList: { node: PMNode; pos: number } | null = null
  let lastHeadingPos = -1
  let lastListPos = -1

  doc.nodesBetween(0, selection.from, (node, pos) => {
    if (node.type.name === 'heading') {
      lastHeadingPos = pos
    } else if (node.type.name === 'orderedList') {
      prevList = { node, pos }
      lastListPos = pos
    }
  })

  if (prevList && lastListPos > lastHeadingPos) {
    return prevList
  }
  return null
}

export function toggleOrderedListSmart(editor: any): boolean {
  if (editor.isActive('orderedList')) {
    return editor.chain().focus().toggleOrderedList().run()
  }

  const state: EditorState | undefined = editor.state
  if (!state) return editor.chain().focus().toggleOrderedList().run()

  const prev = getPreviousOrderedList(state)
  if (prev) {
    const nextStart = (Number(prev.node.attrs.start) || 1) + prev.node.childCount
    return editor.chain().focus().toggleOrderedList().updateAttributes('orderedList', { start: nextStart }).run()
  }

  return editor.chain().focus().toggleOrderedList().run()
}

export function setListStart(editor: any, start: number): boolean {
  return editor.chain().updateAttributes('orderedList', { start: Math.max(1, start) }).run()
}

export function restartListNumbering(editor: any): boolean {
  return setListStart(editor, 1)
}

export function continueListNumbering(editor: any): boolean {
  const state: EditorState | undefined = editor.state
  if (!state) return false
  const prev = getPreviousOrderedList(state)
  if (!prev) return false
  const nextStart = (Number(prev.node.attrs.start) || 1) + prev.node.childCount
  return setListStart(editor, nextStart)
}

interface IndentTarget {
  isActive(name: string): boolean
  getAttributes(name: string): Record<string, unknown>
  can(): { sinkListItem(name: string): boolean; liftListItem(name: string): boolean }
  chain(): {
    focus(): {
      sinkListItem(name: string): { run(): boolean }
      liftListItem(name: string): { run(): boolean }
      updateAttributes(name: string, attributes: Record<string, unknown>): { run(): boolean }
    }
  }
}

const blockType = (editor: IndentTarget) => editor.isActive('heading') ? 'heading' : 'paragraph'
const nextIndent = (editor: IndentTarget, delta: 1 | -1) =>
  Math.min(MAX_INDENT, Math.max(0, (Number(editor.getAttributes(blockType(editor)).indent) || 0) + delta))

/** Lists nest or lift their item; any other block moves by one indent step. */
export function canChangeIndent(editor: IndentTarget, delta: 1 | -1): boolean {
  if (editor.isActive('listItem')) {
    if (delta > 0) {
      if (editor.can().sinkListItem('listItem')) return true
      if ('state' in editor && canSinkListIntoPrevious((editor as any).state)) return true
      return false
    }
    return editor.can().liftListItem('listItem')
  }
  return nextIndent(editor, delta) !== (Number(editor.getAttributes(blockType(editor)).indent) || 0)
}

export function changeIndent(editor: IndentTarget, delta: 1 | -1): boolean {
  if (editor.isActive('listItem')) {
    if (delta > 0) {
      if (editor.can().sinkListItem('listItem')) return editor.chain().focus().sinkListItem('listItem').run()
      if ('state' in editor && sinkListIntoPrevious(editor)) return true
      return false
    }
    return editor.chain().focus().liftListItem('listItem').run()
  }
  return editor.chain().focus().updateAttributes(blockType(editor), { indent: nextIndent(editor, delta) }).run()
}
