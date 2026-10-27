import { Node, ReactNodeViewRenderer, mergeAttributes } from '@tiptap/react'
import { DOMSerializer, type Node as PMNode } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import { ContentBoxView } from './ContentBoxView'

export const BOX_PLACEMENTS = ['flow', 'free'] as const
export type BoxPlacement = (typeof BOX_PLACEMENTS)[number]

export function boxNumber(value: unknown, minimum = 0): number | null {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(500, Math.max(minimum, number)) : null
}

export const BOX_BORDER_MAX_PX = 12
export const DEFAULT_BORDER_COLOR = '#000000'
/** Only plain hex colors reach a style attribute, so a stored value can never inject CSS. */
export const boxBorderColor = (value: unknown): string => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value) ? value.toLowerCase() : DEFAULT_BORDER_COLOR
/** Background override: only #rgb, #rrggbb or #rrggbbaa hex reaches a style attribute; anything else means "no override". */
export function boxBackgroundColor(value: unknown): string | null {
  return typeof value === 'string' && /^#(?:[\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i.test(value) ? value.toLowerCase() : null
}
/** The native color input only understands #rrggbb, so shorter or alpha forms are shown as their opaque color. */
export function boxBackgroundInputValue(value: unknown): string {
  const color = boxBackgroundColor(value)
  if (!color) return '#ffffff'
  if (color.length === 4) return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`
  return color.slice(0, 7)
}
export function boxBorderWidth(value: unknown): number | null {
  const width = boxNumber(value)
  return width === null || width === 0 ? null : Math.min(BOX_BORDER_MAX_PX, Math.round(width))
}

export function boxAttributes(attrs: PMNode['attrs']): Record<string, string> {
  const placement = attrs.placement === 'free' ? 'free' : 'flow'
  const width = boxNumber(attrs.widthMm, 5)
  const height = boxNumber(attrs.heightMm, 5)
  const x = boxNumber(attrs.xMm)
  const y = boxNumber(attrs.yMm)
  const border = boxBorderWidth(attrs.borderWidth)
  const borderColor = boxBorderColor(attrs.borderColor)
  const background = boxBackgroundColor(attrs.backgroundColor)
  return {
    'data-type': 'standard-content-box',
    'data-placement': placement,
    class: 'grimoire-content-box',
    ...(width === null ? {} : { 'data-width-mm': String(width) }),
    ...(height === null ? {} : { 'data-height-mm': String(height) }),
    ...(x === null ? {} : { 'data-x-mm': String(x) }),
    ...(y === null ? {} : { 'data-y-mm': String(y) }),
    ...(border === null ? {} : { 'data-border-width': String(border), 'data-border-color': borderColor }),
    ...(background === null ? {} : { 'data-bg-color': background }),
    style: `${border === null ? '' : `border:${border}px solid ${borderColor};padding:2mm;box-sizing:border-box;`}${background === null ? '' : `background-color:${background};`}${width === null ? '' : `width:${width}mm;`}${height === null ? '' : `min-height:${height}mm;`}${placement === 'free' ? `position:absolute;left:${x ?? 0}mm;top:${y ?? 0}mm;` : ''}`,
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
      borderWidth: { default: null, rendered: false, parseHTML: (element) => boxBorderWidth(element.dataset.borderWidth) },
      borderColor: { default: DEFAULT_BORDER_COLOR, rendered: false, parseHTML: (element) => boxBorderColor(element.dataset.borderColor) },
      backgroundColor: { default: null, rendered: false, parseHTML: (element) => boxBackgroundColor(element.dataset.bgColor) },
    }
  },
  parseHTML() { return [{ tag: 'div[data-type="standard-content-box"]' }] },
  renderHTML({ node, HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, boxAttributes(node.attrs)), 0] },
  addNodeView() { return ReactNodeViewRenderer(ContentBoxView) },
  addKeyboardShortcuts() {
    const exitBoxAfter = () => {
      const { state, view } = this.editor
      const { selection, schema } = state
      if (!selection.empty || !schema.nodes.paragraph) return false
      const { $from } = selection
      let boxDepth = 0
      for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type.name === 'standardContentBox') { boxDepth = d; break }
      }
      if (!boxDepth) return false
      const boxEnd = $from.end(boxDepth)
      // Only exit when at the very end of the last block inside the box.
      if ($from.pos < boxEnd - 1) return false
      const afterBox = $from.after(boxDepth)
      const $after = state.doc.resolve(afterBox)
      if ($after.nodeAfter) {
        const nextSelection = TextSelection.findFrom($after, 1)
        if (nextSelection) {
          view.dispatch(state.tr.setSelection(nextSelection).scrollIntoView())
          return true
        }
      }
      const tr = state.tr.insert(afterBox, schema.nodes.paragraph.create())
      tr.setSelection(TextSelection.create(tr.doc, afterBox + 1)).scrollIntoView()
      view.dispatch(tr)
      return true
    }
    return {
      ArrowDown: () => exitBoxAfter(),
      'Mod-Enter': () => exitBoxAfter(),
    }
  },
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
