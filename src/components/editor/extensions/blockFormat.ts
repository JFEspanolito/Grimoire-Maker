import { Fragment, type Node as PMNode } from '@tiptap/pm/model'
import { Extension, getHTMLFromFragment } from '@tiptap/react'

export const INDENT_STEP_EM = 2
export const MAX_INDENT = 6

const indent = {
  indent: {
    default: 0,
    parseHTML: (element: HTMLElement) => Math.min(MAX_INDENT, Math.max(0, Number(element.getAttribute('data-indent')) || 0)),
    renderHTML: (attributes: Record<string, unknown>) => attributes.indent
      ? { 'data-indent': String(attributes.indent), style: `margin-left: ${Number(attributes.indent) * INDENT_STEP_EM}em` }
      : {},
  },
}

interface SerializerState {
  write(text: string): void
  closeBlock(node: PMNode): void
  renderInline(node: PMNode, escape?: boolean): void
  repeat(text: string, count: number): string
}

/** Plain Markdown cannot carry alignment or indentation, so only those blocks are written as HTML. */
const isFormatted = (node: PMNode) => (node.attrs.textAlign && node.attrs.textAlign !== 'left') || node.attrs.indent > 0

function writeHtml(state: SerializerState, node: PMNode) {
  state.write(getHTMLFromFragment(Fragment.from(node), node.type.schema))
  state.closeBlock(node)
}

/** Paragraph that remembers its indent and keeps alignment and indent when saved as Markdown. */
/**
 * StarterKit owns the paragraph and heading nodes, so this adds the indent attribute globally and
 * replaces their Markdown serializers once the editor exists (the serializer reads them lazily).
 */
export const BlockFormat = Extension.create({
  name: 'blockFormat',
  addGlobalAttributes() {
    return [{ types: ['paragraph', 'heading'], attributes: indent }]
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
    }
    for (const [name, serialize] of Object.entries(serializers)) {
      const extension = nodes.find((candidate) => candidate.name === name)
      // `storage` is rebuilt from `addStorage` on every read, so the override has to live there.
      if (extension) (extension.config as { addStorage?: () => unknown }).addStorage = () => ({ markdown: { serialize, parse: {} } })
    }
  },
})

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
  if (editor.isActive('listItem')) return delta > 0 ? editor.can().sinkListItem('listItem') : editor.can().liftListItem('listItem')
  return nextIndent(editor, delta) !== (Number(editor.getAttributes(blockType(editor)).indent) || 0)
}

export function changeIndent(editor: IndentTarget, delta: 1 | -1): boolean {
  if (editor.isActive('listItem')) {
    return delta > 0 ? editor.chain().focus().sinkListItem('listItem').run() : editor.chain().focus().liftListItem('listItem').run()
  }
  return editor.chain().focus().updateAttributes(blockType(editor), { indent: nextIndent(editor, delta) }).run()
}
