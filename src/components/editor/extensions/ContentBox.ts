import { Node, ReactNodeViewRenderer, mergeAttributes } from '@tiptap/react'
import { DOMSerializer, type Node as PMNode } from '@tiptap/pm/model'
import { ContentBoxView } from './ContentBoxView'

export const BOX_PLACEMENTS = ['flow', 'free'] as const
export type BoxPlacement = (typeof BOX_PLACEMENTS)[number]

export function boxNumber(value: unknown, minimum = 0): number | null {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(500, Math.max(minimum, number)) : null
}

export function boxAttributes(attrs: PMNode['attrs']): Record<string, string> {
  const placement = attrs.placement === 'free' ? 'free' : 'flow'
  const width = boxNumber(attrs.widthMm, 5)
  const height = boxNumber(attrs.heightMm, 5)
  const x = boxNumber(attrs.xMm)
  const y = boxNumber(attrs.yMm)
  return {
    'data-type': 'standard-content-box',
    'data-placement': placement,
    class: 'grimoire-content-box',
    ...(width === null ? {} : { 'data-width-mm': String(width) }),
    ...(height === null ? {} : { 'data-height-mm': String(height) }),
    ...(x === null ? {} : { 'data-x-mm': String(x) }),
    ...(y === null ? {} : { 'data-y-mm': String(y) }),
    style: `${width === null ? '' : `width:${width}mm;`}${height === null ? '' : `min-height:${height}mm;`}${placement === 'free' ? `position:absolute;left:${x ?? 0}mm;top:${y ?? 0}mm;` : ''}`,
  }
}

interface MarkdownState { write(value: string): void; closeBlock(node: PMNode): void }

/** HTML-in-Markdown is the existing document format's extension boundary; no migration is needed. */
export const ContentBox = Node.create({
  name: 'standardContentBox',
  group: 'block',
  content: 'block+',
  defining: true,
  isolating: true,
  addAttributes() {
    return {
      placement: { default: 'flow', rendered: false, parseHTML: (element) => element.dataset.placement === 'free' ? 'free' : 'flow' },
      widthMm: { default: null, rendered: false, parseHTML: (element) => boxNumber(element.dataset.widthMm, 5) },
      heightMm: { default: null, rendered: false, parseHTML: (element) => boxNumber(element.dataset.heightMm, 5) },
      xMm: { default: null, rendered: false, parseHTML: (element) => boxNumber(element.dataset.xMm) },
      yMm: { default: null, rendered: false, parseHTML: (element) => boxNumber(element.dataset.yMm) },
    }
  },
  parseHTML() { return [{ tag: 'div[data-type="standard-content-box"]' }] },
  renderHTML({ node, HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, boxAttributes(node.attrs)), 0] },
  addNodeView() { return ReactNodeViewRenderer(ContentBoxView) },
  addStorage() {
    return { markdown: {
      serialize(state: MarkdownState, node: PMNode) {
        // Serialize children as HTML too: nested custom blocks and tables must stay inside the box.
        const element = document.createElement('div')
        for (const [name, value] of Object.entries(boxAttributes(node.attrs))) element.setAttribute(name, value)
        element.append(DOMSerializer.fromSchema(node.type.schema).serializeFragment(node.content))
        state.write(element.outerHTML)
        state.closeBlock(node)
      },
      parse: {},
    } }
  },
})
