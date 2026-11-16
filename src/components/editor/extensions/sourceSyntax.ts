import { Extension } from '@tiptap/react'
import { Fragment, type Mark, type Node as PMNode } from '@tiptap/pm/model'
import { getHTMLFromFragment } from '@tiptap/react'

/**
 * Remembers which of the equivalent Markdown spellings the author used (bullet `*`/`+`/`-`,
 * emphasis `_`/`*`, strong `__`/`**`, setext headings, two-space hard breaks) and writes the same
 * one back. Content created in the editor keeps the defaults: `-`, `*`, `**`, `#` and `\`.
 */

const MARKUP_ATTR = 'data-md-markup'

interface MdToken {
  type: string; markup: string; children: MdToken[] | null
  attrSet(name: string, value: string): void
}
type InlineRule = (state: { tokens: MdToken[] }, silent: boolean) => boolean
interface MarkdownIt {
  core: { ruler: { push(name: string, fn: (state: { tokens: MdToken[] }) => void): void } }
  inline: { ruler: { at(name: string, fn: InlineRule): void; __rules__: { name: string; fn: InlineRule }[] } }
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
  md.core.ruler.push('grimoire_source_syntax', state => {
    const visit = (tokens: MdToken[]) => {
      for (const token of tokens) {
        const setext = token.type === 'heading_open' && (token.markup === '=' || token.markup === '-')
        if ((MARKED.has(token.type) || setext) && token.markup) token.attrSet(MARKUP_ATTR, token.markup)
        if (token.children) visit(token.children)
      }
    }
    visit(state.tokens)
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
type MarkString = (this: { marks: MarkSpecs }, mark: Mark, open: boolean, parent: PMNode, index: number) => string
const patchedStates = new WeakSet<object>()

/**
 * tiptap-markdown's serializer state needs each emphasis delimiter as a fixed string (it moves
 * enclosing spaces outside the mark with it), so a mark's own spelling is swapped in for the
 * duration of that mark instead of being a function. Its state class is not exported, so the
 * prototype is patched once, from the first state this extension's serializers see.
 */
function preserveMarkDelimiters(state: object): void {
  const prototype = Object.getPrototypeOf(state) as { markString: MarkString }
  if (patchedStates.has(prototype)) return
  patchedStates.add(prototype)
  const original = prototype.markString
  prototype.markString = function (mark, open, parent, index) {
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
      { types: ['heading'], attributes: { setext: markupAttribute(['=', '-']).markup } },
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
  },

  onCreate() {
    // Serialize one hard break so the state prototype is patched before any document is saved.
    const { schema } = this.editor
    const serializer = (this.editor.storage as unknown as { markdown?: { serializer?: { serialize(node: PMNode): string } } }).markdown?.serializer
    if (!serializer || !schema.nodes.hardBreak) return
    try {
      serializer.serialize(schema.nodes.paragraph.create(null, [schema.nodes.hardBreak.create(), schema.text('x')]))
    } catch {
      // The probe only primes the patch; bullet lists and hard breaks also apply it on first use.
    }
  },
})
