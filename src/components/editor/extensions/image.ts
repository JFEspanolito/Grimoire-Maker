import Image from '@tiptap/extension-image'
import type { Node as PMNode } from '@tiptap/pm/model'

export const IMAGE_ALIGNS = ['none', 'left', 'center', 'right'] as const
export const IMAGE_FRAMES = ['none', 'simple', 'double', 'shadow'] as const
/** `flow` sits in the text; the others pin the image to the page itself. */
export const IMAGE_ANCHORS = ['flow', 'header', 'footer', 'background', 'free'] as const

export type ImageAlign = (typeof IMAGE_ALIGNS)[number]
export type ImageFrame = (typeof IMAGE_FRAMES)[number]
export type ImageAnchor = (typeof IMAGE_ANCHORS)[number]

function oneOf<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.find((a) => a === value) ?? fallback
}

function number(value: string | null): number | null {
  const n = value === null ? NaN : Number(value)
  return Number.isFinite(n) ? n : null
}

function coordinate(value: string | null): number | null {
  const parsed = number(value)
  return parsed === null ? null : Math.min(500, Math.max(0, parsed))
}

const escapeAttr = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

interface MarkdownState {
  write(text: string): void
  esc(text: string): string
  closeBlock(node: PMNode): void
}

/**
 * Only plain Markdown can't carry layout, so an image with any layout attribute
 * (or a path Markdown can't write safely) is stored as an `<img>` HTML tag. A plain
 * image stays `![alt](src)`, keeping simple files readable everywhere.
 */
function needsHtml(attrs: PMNode['attrs']): boolean {
  return (
    attrs.align !== 'none' ||
    attrs.widthMm !== null ||
    attrs.frame !== 'none' ||
    attrs.opacity !== 1 ||
    attrs.anchor !== 'flow' ||
    attrs.xMm !== null ||
    attrs.yMm !== null ||
    /[\s()]/.test(String(attrs.src))
  )
}

function toHtml(attrs: PMNode['attrs']): string {
  const parts = [`src="${escapeAttr(String(attrs.src))}"`]
  if (attrs.alt) parts.push(`alt="${escapeAttr(String(attrs.alt))}"`)
  if (attrs.title) parts.push(`title="${escapeAttr(String(attrs.title))}"`)
  if (attrs.align !== 'none') parts.push(`data-align="${attrs.align}"`)
  if (attrs.widthMm !== null) parts.push(`data-width-mm="${attrs.widthMm}"`)
  if (attrs.frame !== 'none') parts.push(`data-frame="${attrs.frame}"`)
  if (attrs.opacity !== 1) parts.push(`data-opacity="${attrs.opacity}"`)
  if (attrs.anchor !== 'flow') parts.push(`data-anchor="${attrs.anchor}"`)
  if (attrs.xMm !== null) parts.push(`data-x-mm="${attrs.xMm}"`)
  if (attrs.yMm !== null) parts.push(`data-y-mm="${attrs.yMm}"`)
  return `<img ${parts.join(' ')} />`
}

/** Image with text wrap, size in millimetres, frame, opacity and page anchoring. */
export const GrimoireImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      align: {
        default: 'none',
        parseHTML: (el) => oneOf(el.getAttribute('data-align'), IMAGE_ALIGNS, 'none'),
        renderHTML: (attrs) => (attrs.align === 'none' ? {} : { 'data-align': attrs.align }),
      },
      widthMm: {
        default: null,
        parseHTML: (el) => number(el.getAttribute('data-width-mm')),
        renderHTML: (attrs) =>
          attrs.widthMm === null
            ? {}
            : { 'data-width-mm': String(attrs.widthMm), style: `width:${attrs.widthMm}mm` },
      },
      frame: {
        default: 'none',
        parseHTML: (el) => oneOf(el.getAttribute('data-frame'), IMAGE_FRAMES, 'none'),
        renderHTML: (attrs) => (attrs.frame === 'none' ? {} : { 'data-frame': attrs.frame }),
      },
      opacity: {
        default: 1,
        parseHTML: (el) => {
          const n = number(el.getAttribute('data-opacity'))
          return n === null ? 1 : Math.min(1, Math.max(0, n))
        },
        renderHTML: (attrs) =>
          attrs.opacity === 1
            ? {}
            : { 'data-opacity': String(attrs.opacity), style: `opacity:${attrs.opacity}` },
      },
      anchor: {
        default: 'flow',
        parseHTML: (el) => oneOf(el.getAttribute('data-anchor'), IMAGE_ANCHORS, 'flow'),
        renderHTML: (attrs) => (attrs.anchor === 'flow' ? {} : { 'data-anchor': attrs.anchor }),
      },
      xMm: {
        default: null,
        parseHTML: (el) => coordinate(el.getAttribute('data-x-mm')),
        renderHTML: (attrs) => attrs.xMm === null ? {} : { 'data-x-mm': String(attrs.xMm) },
      },
      yMm: {
        default: null,
        parseHTML: (el) => coordinate(el.getAttribute('data-y-mm')),
        renderHTML: (attrs) => attrs.yMm === null ? {} : { 'data-y-mm': String(attrs.yMm) },
      },
    }
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownState, node: PMNode) {
          if (needsHtml(node.attrs)) {
            state.write(toHtml(node.attrs))
          } else {
            const title = node.attrs.title ? ` "${String(node.attrs.title).replace(/"/g, '\\"')}"` : ''
            state.write(`![${state.esc(String(node.attrs.alt ?? ''))}](${node.attrs.src}${title})`)
          }
          state.closeBlock(node)
        },
        parse: {},
      },
    }
  },
})
