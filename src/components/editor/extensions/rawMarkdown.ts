import { Node } from '@tiptap/react'
import { DOMParser as PMDOMParser, type Node as PMNode, type Schema } from '@tiptap/pm/model'

/**
 * Keeps Markdown the editor has no node for (HTML comments, HTML elements outside the schema,
 * footnotes, wikilinks and task-list markers) as uneditable source, so opening and editing a
 * document never silently drops it. Preserved source is written back byte-for-byte.
 */

interface MarkdownState { write(text: string): void; closeBlock(node: PMNode): void }

interface MdToken { type: string; content: string; children: MdToken[] | null; map: [number, number] | null }
interface MdBlockState {
  src: string; bMarks: number[]; eMarks: number[]; tShift: number[]; sCount: number[]; blkIndent: number; line: number
  isEmpty(line: number): boolean
  getLines(begin: number, end: number, indent: number, keepLastLF: boolean): string
  push(type: string, tag: string, nesting: number): MdToken
}
interface MdInlineState { src: string; pos: number; push(type: string, tag: string, nesting: number): MdToken }
interface MdCoreState { tokens: MdToken[]; Token: new (type: string, tag: string, nesting: number) => MdToken }
type Rule<S> = (state: S, ...rest: never[]) => boolean | void
interface Ruler<S> {
  before(name: string, rule: string, fn: Rule<S>, options?: { alt: string[] }): void
  after(name: string, rule: string, fn: Rule<S>): void
}
interface MarkdownIt {
  block: { ruler: Ruler<MdBlockState> }
  inline: { ruler: Ruler<MdInlineState> }
  core: { ruler: Ruler<MdCoreState> }
  renderer: { rules: Record<string, (tokens: MdToken[], index: number) => string> }
  utils: { escapeHtml(text: string): string }
  __grimoireRawMarkdown?: boolean
}

const BLOCK_ATTR = 'data-raw-markdown'
const INLINE_ATTR = 'data-raw-markdown-inline'
/** Structural table elements ProseMirror passes through without a rule of their own. */
const TRANSPARENT = new Set(['THEAD', 'TBODY', 'TFOOT', 'COLGROUP', 'COL'])
const FOOTNOTE_DEFINITION = /^\[\^[^\]\s]+\]:/
const INLINE_SOURCE = /^(?:\[\[[^[\]\n]+\]\]|\[\^[^\]\s]+\](?![(:]))/
const TASK_MARKER = /^\[[ xX]\](?=\s|$)/

function footnoteDefinition(state: MdBlockState, startLine: number, endLine: number, silent: boolean): boolean {
  if (state.sCount[startLine] - state.blkIndent >= 4) return false
  const start = state.bMarks[startLine] + state.tShift[startLine]
  if (!FOOTNOTE_DEFINITION.test(state.src.slice(start, state.eMarks[startLine]))) return false
  if (silent) return true
  let next = startLine + 1
  // Continuation lines of a definition are indented, as in the common footnote extension.
  while (next < endLine && !state.isEmpty(next) && state.sCount[next] - state.blkIndent >= 4) next++
  const token = state.push('raw_markdown_block', '', 0)
  token.content = state.getLines(startLine, next, state.blkIndent, false).replace(/\n$/, '')
  token.map = [startLine, next]
  state.line = next
  return true
}

function inlineSource(state: MdInlineState, silent: boolean): boolean {
  if (state.src.charCodeAt(state.pos) !== 0x5b) return false
  const match = INLINE_SOURCE.exec(state.src.slice(state.pos))
  if (!match) return false
  if (!silent) state.push('raw_markdown_inline', '', 0).content = match[0]
  state.pos += match[0].length
  return true
}

/** A list item whose text starts with `[ ]`/`[x]` keeps that marker as source. */
function taskMarkers(state: MdCoreState): void {
  const { tokens } = state
  for (let i = 2; i < tokens.length; i++) {
    if (tokens[i].type !== 'inline' || tokens[i - 1].type !== 'paragraph_open' || tokens[i - 2].type !== 'list_item_open') continue
    const children = tokens[i].children
    const first = children?.[0]
    const match = first?.type === 'text' ? TASK_MARKER.exec(first.content) : null
    if (!children || !first || !match) continue
    const marker = new state.Token('raw_markdown_inline', '', 0)
    marker.content = match[0]
    first.content = first.content.slice(match[0].length)
    children.unshift(marker)
  }
}

export function setupRawMarkdown(md: MarkdownIt): void {
  // tiptap-markdown runs every extension's setup on each parse; register the rules once.
  if (md.__grimoireRawMarkdown) return
  md.__grimoireRawMarkdown = true
  md.block.ruler.before('reference', 'raw_footnote_definition', footnoteDefinition as Rule<MdBlockState>, { alt: ['paragraph', 'reference'] })
  md.inline.ruler.before('link', 'raw_markdown_inline', inlineSource as Rule<MdInlineState>)
  md.core.ruler.after('inline', 'raw_task_marker', taskMarkers)
  md.renderer.rules.raw_markdown_block = (tokens, index) => `<div ${BLOCK_ATTR}="${md.utils.escapeHtml(tokens[index].content)}"></div>`
  md.renderer.rules.raw_markdown_inline = (tokens, index) => `<span ${INLINE_ATTR}="${md.utils.escapeHtml(tokens[index].content)}"></span>`
}

function isKnown(element: Element, parser: PMDOMParser): boolean {
  return parser.rules.some(rule => 'tag' in rule && !!rule.tag && element.matches(rule.tag)
    && (!rule.getAttrs || rule.getAttrs(element as HTMLElement) !== false))
}

/** Inline when it sits in text (a paragraph, heading, table cell or tight list item); otherwise a block. */
function isInline(node: ChildNode, root: Element): boolean {
  const parent = node.parentElement
  return !!parent && parent !== root && !!parent.closest('p,h1,h2,h3,h4,h5,h6,td,th,li')
}

/** Replaces comments and elements no schema rule reads with nodes that hold their exact source. */
export function preserveUnknownHtml(root: Element, schema: Schema): void {
  const parser = PMDOMParser.fromSchema(schema)
  const document = root.ownerDocument
  const visit = (parent: Element) => {
    for (const child of Array.from(parent.childNodes)) {
      let source: string | null = null
      if (child.nodeType === child.COMMENT_NODE) source = `<!--${(child as Comment).data}-->`
      else if (child.nodeType === child.ELEMENT_NODE) {
        const element = child as Element
        if (TRANSPARENT.has(element.tagName) || isKnown(element, parser)) { visit(element); continue }
        source = element.outerHTML
      }
      if (source === null) continue
      const inline = isInline(child, root)
      const holder = document.createElement(inline ? 'span' : 'div')
      holder.setAttribute(inline ? INLINE_ATTR : BLOCK_ATTR, source)
      child.replaceWith(holder)
    }
  }
  visit(root)
}

/** Comments are notes to the author: shown in the editor, never printed. */
const rawClass = (source: string) => source.startsWith('<!--') ? 'grimoire-raw-markdown grimoire-raw-markdown-comment' : 'grimoire-raw-markdown'

export const RawMarkdownBlock = Node.create({
  name: 'rawMarkdownBlock',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return { source: { default: '', parseHTML: element => element.getAttribute(BLOCK_ATTR) ?? '', rendered: false } }
  },
  parseHTML() {
    return [{ tag: `div[${BLOCK_ATTR}]` }]
  },
  renderHTML({ node }) {
    return ['div', { [BLOCK_ATTR]: node.attrs.source, class: rawClass(node.attrs.source), contenteditable: 'false' }, node.attrs.source]
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownState, node: PMNode) {
          state.write(node.attrs.source)
          state.closeBlock(node)
        },
        parse: {
          setup: setupRawMarkdown,
          updateDOM(this: { editor: { schema: Schema } }, element: HTMLElement) {
            preserveUnknownHtml(element, this.editor.schema)
          },
        },
      },
    }
  },
})

export const RawMarkdownInline = Node.create({
  name: 'rawMarkdownInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return { source: { default: '', parseHTML: element => element.getAttribute(INLINE_ATTR) ?? '', rendered: false } }
  },
  parseHTML() {
    return [{ tag: `span[${INLINE_ATTR}]` }]
  },
  renderHTML({ node }) {
    return ['span', { [INLINE_ATTR]: node.attrs.source, class: rawClass(node.attrs.source), contenteditable: 'false' }, node.attrs.source]
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownState, node: PMNode) {
          state.write(node.attrs.source)
        },
        parse: {},
      },
    }
  },
})
