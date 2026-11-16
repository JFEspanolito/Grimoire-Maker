import { Extension } from '@tiptap/react'
import { Fragment, type Mark, type Node as PMNode } from '@tiptap/pm/model'
import { getHTMLFromFragment } from '@tiptap/react'

/**
 * Remembers which of the equivalent Markdown spellings the author used and writes the same one
 * back: bullet `*`/`+`/`-`, emphasis `_`/`*`, strong `__`/`**`, setext headings, two-space hard
 * breaks, reference links (`[text][1]` with their `[1]: url` definitions) and the number of blank
 * lines between blocks. Content created in the editor keeps the defaults: `-`, `*`, `**`, `#`, `\`,
 * inline links and one blank line.
 */

const MARKUP_ATTR = 'data-md-markup'
const GAP_ATTR = 'data-md-gap'
const REFERENCE_ATTR = 'data-md-reference'
const REFERENCE_HREF_ATTR = 'data-md-reference-href'

interface MdToken {
  type: string; markup: string; content: string; level: number; nesting: number
  map: [number, number] | null; children: MdToken[] | null
  attrSet(name: string, value: string): void
  attrGet(name: string): string | null
}
interface MdInlineState {
  src: string; pos: number; tokens: MdToken[]
  md: { helpers: { parseLinkLabel(state: MdInlineState, start: number, disableNested?: boolean): number } }
}
interface MdBlockState {
  line: number; blkIndent: number
  getLines(begin: number, end: number, indent: number, keepLastLF: boolean): string
  push(type: string, tag: string, nesting: number): MdToken
}
type InlineRule = (state: MdInlineState, silent: boolean) => boolean
type BlockRule = (state: MdBlockState, startLine: number, endLine: number, silent: boolean) => boolean
interface Ruler<F> { at(name: string, fn: F, options?: { alt?: string[] }): void; __rules__: { name: string; fn: F; alt: string[] }[] }
interface MarkdownIt {
  core: { ruler: { push(name: string, fn: (state: { tokens: MdToken[]; src?: string }) => void): void } }
  block: { ruler: Ruler<BlockRule> }
  inline: { ruler: Ruler<InlineRule> }
  renderer: { rules: Record<string, (tokens: MdToken[], index: number) => string> }
  __grimoireSourceSyntax?: boolean
}

interface SerializerState {
  write(text: string): void
  ensureNewLine(): void
  closeBlock(node: PMNode): void
  renderInline(node: PMNode, fromBlockStart?: boolean): void
  renderList(node: PMNode, delim: string, firstDelim: (index: number) => string): void
  inTable?: boolean
}

const MARKED = new Set(['bullet_list_open', 'em_open', 'strong_open'])

export function setupSourceSyntax(md: MarkdownIt): void {
  // tiptap-markdown runs every extension's setup on each parse; register once.
  if (md.__grimoireSourceSyntax) return
  md.__grimoireSourceSyntax = true
  // markdown-it gives both hard-break spellings the same token; tag the two-space one where it is made.
  const newline = md.inline.ruler.__rules__.find(rule => rule.name === 'newline')?.fn
  if (newline) {
    md.inline.ruler.at('newline', (state, silent) => {
      const before = state.tokens.length
      const matched = newline(state, silent)
      const token = state.tokens[state.tokens.length - 1]
      if (matched && state.tokens.length > before && token.type === 'hardbreak') token.markup = '  '
      return matched
    })
  }
  // A reference definition leaves no token; keep its source as a raw block (rawMarkdown.ts renders it).
  const reference = md.block.ruler.__rules__.find(rule => rule.name === 'reference')
  // `at` replaces `fn` on this same rule object, so keep the original function first.
  const referenceRule = reference?.fn
  if (reference) {
    md.block.ruler.at('reference', (state, startLine, endLine, silent) => {
      const matched = referenceRule!(state, startLine, endLine, silent)
      if (matched && !silent) {
        const token = state.push('raw_markdown_block', '', 0)
        token.content = state.getLines(startLine, state.line, state.blkIndent, false).replace(/\n$/, '')
        token.map = [startLine, state.line]
      }
      return matched
    }, { alt: [...reference.alt] })
  }
  // Remember how a reference link was written (`[1]`, `[]` or nothing after the text) and its address.
  const link = md.inline.ruler.__rules__.find(rule => rule.name === 'link')
  const linkRule = link?.fn
  if (link) {
    md.inline.ruler.at('link', (state, silent) => {
      const start = state.pos
      const before = state.tokens.length
      const matched = linkRule!(state, silent)
      // Pending text before the link is flushed into its own token first.
      const open = state.tokens.slice(before).find(token => token.type === 'link_open')
      if (!matched || silent || open?.type !== 'link_open') return matched
      const labelEnd = state.md.helpers.parseLinkLabel(state, start, true)
      const after = labelEnd < 0 ? '(' : state.src.slice(labelEnd + 1, state.pos)
      if (!after.startsWith('(')) {
        open.attrSet(REFERENCE_ATTR, after)
        open.attrSet(REFERENCE_HREF_ATTR, open.attrGet('href') ?? '')
      }
      return matched
    }, { alt: [...link.alt] })
  }
  md.core.ruler.push('grimoire_source_syntax', (state: { tokens: MdToken[]; src?: string }) => {
    const visit = (tokens: MdToken[]) => {
      for (const token of tokens) {
        const setext = token.type === 'heading_open' && (token.markup === '=' || token.markup === '-')
        if ((MARKED.has(token.type) || setext) && token.markup) token.attrSet(MARKUP_ATTR, token.markup)
        if (token.children) visit(token.children)
      }
    }
    visit(state.tokens)
    // Blank lines before each top-level block, when not the usual one. Counted from the source,
    // because a list's line range also covers the blank lines after it.
    const lines = (state.src ?? '').split('\n')
    const blank = (line: number) => line >= 0 && line < lines.length && !lines[line].trim()
    let previousEnd: number | null = null
    for (const token of state.tokens) {
      if (token.level !== 0 || token.nesting === -1 || !token.map) continue
      if (previousEnd !== null) {
        let gap = 0
        for (let line = token.map[0] - 1; line >= previousEnd && blank(line); line--) gap++
        if (gap !== 1) token.attrSet(GAP_ATTR, String(gap))
      }
      let end = token.map[1]
      while (end > token.map[0] && blank(end - 1)) end--
      previousEnd = end
    }
  })
  md.renderer.rules.hardbreak = (tokens, index) => tokens[index].markup === '  ' ? `<br ${MARKUP_ATTR}="spaces">` : '<br>'
}

const markupAttribute = (allowed: readonly string[]) => ({
  markup: {
    default: null,
    rendered: false,
    parseHTML: (element: HTMLElement) => {
      const value = element.getAttribute(MARKUP_ATTR)
      return value && allowed.includes(value) ? value : null
    },
  },
})

type MarkSpecs = Record<string, { open: unknown; close: unknown; sourceMarkup?: boolean }>
interface PatchedState { marks: MarkSpecs; inAutolink?: boolean; closed: unknown; flushClose(size?: number): void }
type MarkString = (this: PatchedState, mark: Mark, open: boolean, parent: PMNode, index: number) => string
type Render = (this: PatchedState, node: PMNode, parent: PMNode, index: number) => void
const patchedStates = new WeakSet<object>()

/**
 * tiptap-markdown's serializer state needs each emphasis delimiter as a fixed string (it moves
 * enclosing spaces outside the mark with it), so a mark's own spelling is swapped in for the
 * duration of that mark instead of being a function. Its state class is not exported, so the
 * prototype is patched once, from the first state this extension's serializers see.
 */
function preserveMarkDelimiters(state: object): void {
  const prototype = Object.getPrototypeOf(state) as { markString: MarkString; render: Render }
  if (patchedStates.has(prototype)) return
  patchedStates.add(prototype)
  const render = prototype.render
  prototype.render = function (node, parent, index) {
    const gap = node.attrs?.gapBefore as unknown
    // flushClose(n) ends the previous block with n - 1 blank lines.
    if (typeof gap === 'number' && this.closed) this.flushClose(gap + 1)
    return render.call(this, node, parent, index)
  }
  const original = prototype.markString
  prototype.markString = function (mark, open, parent, index) {
    // A reference link whose address still matches its definition is written the way it was read.
    const reference = mark.attrs.reference as unknown
    if (mark.type.name === 'link' && typeof reference === 'string' && mark.attrs.href === mark.attrs.referenceHref) {
      if (!open) return `]${reference}`
      this.inAutolink = false
      return '['
    }
    const info = this.marks[mark.type.name]
    const markup = mark.attrs.markup as unknown
    if (!info?.sourceMarkup || typeof markup !== 'string') return original.call(this, mark, open, parent, index)
    const saved = { open: info.open, close: info.close }
    info.open = info.close = markup
    try {
      return original.call(this, mark, open, parent, index)
    } finally {
      info.open = saved.open
      info.close = saved.close
    }
  }
}

export const SourceSyntax = Extension.create({
  name: 'sourceSyntax',

  addGlobalAttributes() {
    return [
      { types: ['bulletList'], attributes: markupAttribute(['*', '+', '-']) },
      { types: ['italic'], attributes: markupAttribute(['*', '_']) },
      { types: ['bold'], attributes: markupAttribute(['**', '__']) },
      { types: ['hardBreak'], attributes: markupAttribute(['spaces']) },
      // Read by the heading serializer in blockFormat.ts.
      { types: ['heading'], attributes: { setext: { ...markupAttribute(['=', '-']).markup, keepOnSplit: false } } },
      {
        types: ['link'],
        attributes: {
          reference: { default: null, rendered: false, parseHTML: (element: HTMLElement) => element.getAttribute(REFERENCE_ATTR) },
          referenceHref: { default: null, rendered: false, parseHTML: (element: HTMLElement) => element.getAttribute(REFERENCE_HREF_ATTR) },
        },
      },
      {
        types: ['paragraph', 'heading', 'bulletList', 'orderedList', 'blockquote', 'table', 'horizontalRule', 'rawMarkdownBlock'],
        attributes: {
          gapBefore: {
            default: null,
            rendered: false,
            // A block split off with Enter is new content: one blank line, like anything typed.
            keepOnSplit: false,
            parseHTML: (element: HTMLElement) => {
              const gap = Number(element.getAttribute(GAP_ATTR) ?? NaN)
              return Number.isInteger(gap) && gap >= 0 && gap <= 100 ? gap : null
            },
          },
        },
      },
    ]
  },

  addStorage() {
    return { markdown: { parse: { setup: setupSourceSyntax } } }
  },

  onBeforeCreate() {
    const extensions = this.editor.extensionManager.extensions
    const serializers: Record<string, unknown> = {
      bulletList(state: SerializerState, node: PMNode) {
        preserveMarkDelimiters(state)
        state.renderList(node, '  ', () => `${(node.attrs.markup as string | null) ?? '-'} `)
      },
      italic: { open: '*', close: '*', mixable: true, expelEnclosingWhitespace: true, sourceMarkup: true },
      bold: { open: '**', close: '**', mixable: true, expelEnclosingWhitespace: true, sourceMarkup: true },
      hardBreak(state: SerializerState, node: PMNode, parent: PMNode, index: number) {
        preserveMarkDelimiters(state)
        for (let i = index + 1; i < parent.childCount; i++) {
          if (parent.child(i).type !== node.type) {
            if (state.inTable) state.write(getHTMLFromFragment(Fragment.from(node), node.type.schema))
            else state.write(node.attrs.markup === 'spaces' ? '  \n' : '\\\n')
            return
          }
        }
      },
    }
    for (const [name, serialize] of Object.entries(serializers)) {
      const extension = extensions.find(candidate => candidate.name === name)
      // Storage is rebuilt from `addStorage` on every read, so the override has to live there (as in blockFormat.ts).
      if (extension) (extension.config as { addStorage?: () => unknown }).addStorage = () => ({ markdown: { serialize, parse: {} } })
    }
    // Every node serializer patches the state first, so the patch is in place before the first
    // mark or gap of any document is written (the create event fires too late for a probe).
    for (const extension of extensions) {
      if (extension.type !== 'node') continue
      const config = extension.config as { addStorage?: (...args: unknown[]) => unknown }
      const addStorage = config.addStorage
      if (!addStorage) continue
      config.addStorage = function (this: unknown, ...args: unknown[]) {
        const storage = addStorage.apply(this, args) as { markdown?: { serialize?: (...rest: unknown[]) => unknown } } | undefined
        const serialize = storage?.markdown?.serialize
        if (typeof serialize !== 'function') return storage
        return {
          ...storage,
          markdown: {
            ...storage!.markdown,
            serialize(this: unknown, state: object, ...rest: unknown[]) {
              preserveMarkDelimiters(state)
              return serialize.call(this, state, ...rest)
            },
          },
        }
      }
    }
  },

})
