import { Node } from '@tiptap/react'
import type { Node as PMNode } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import { canJoin } from '@tiptap/pm/transform'

export type SectionColumns = 1 | 2 | null

/** A section is a run of pages with its own column count; null follows the file's default. */
export function sectionColumns(value: unknown): SectionColumns {
  const columns = Number(value)
  return columns === 1 || columns === 2 ? columns : null
}

const MARKER = 'div[data-type="section-break"]'

interface MarkdownState {
  write(text: string): void
  closeBlock(node: PMNode): void
  renderContent(node: PMNode): void
}

declare module '@tiptap/react' {
  interface Commands<ReturnType> {
    section: {
      /** Starts a new section (and a new page) at the cursor. */
      insertSectionBreak: () => ReturnType
      /** Sets the column count of the section holding the cursor; null follows the file default. */
      setSectionColumns: (columns: SectionColumns) => ReturnType
      /** Joins the section holding the cursor to the one before it. */
      mergeSectionWithPrevious: () => ReturnType
      /**
       * Sets the columns of one page. `start` and `next` are the positions before the first block of that page
       * and of the following one; the sections needed to isolate the page are created and tidied automatically.
       */
      setPageColumns: (page: { start: number; next: number | null; columns: SectionColumns }) => ReturnType
    }
  }
}

/** The document is a sequence of sections; plain Markdown without breaks is simply one section. */
export const SectionDocument = Node.create({ name: 'doc', topNode: true, content: 'section+' })

export const Section = Node.create({
  name: 'section',
  content: 'block+',
  addAttributes() {
    return {
      columns: { default: null, rendered: false, parseHTML: (element: HTMLElement) => sectionColumns(element.dataset.columns) },
      // A section made by the page columns control: it is bookkeeping and disappears again when it stops differing.
      auto: { default: false, rendered: false, parseHTML: (element: HTMLElement) => element.dataset.auto === 'true' },
    }
  },
  parseHTML() { return [{ tag: 'section[data-type="page-section"]' }] },
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('section')
      dom.dataset.type = 'page-section'
      dom.className = 'grimoire-section'
      const applyColumns = (current: PMNode) => {
        const columns = sectionColumns(current.attrs.columns)
        if (columns) {
          dom.dataset.columns = String(columns)
          dom.style.setProperty('--section-columns', String(columns))
        } else {
          delete dom.dataset.columns
          dom.style.removeProperty('--section-columns')
        }
      }
      applyColumns(node)
      return {
        dom,
        contentDOM: dom,
        update(next) {
          if (next.type !== node.type) return false
          applyColumns(next)
          return true
        },
        // Pagination owns section styles, not document content. Keep descendant
        // text/child mutations visible to ProseMirror so editing remains native.
        ignoreMutation: mutation => mutation.type === 'attributes'
          && mutation.target === dom && mutation.attributeName === 'style',
      }
    }
  },
  renderHTML({ node }) {
    const columns = sectionColumns(node.attrs.columns)
    return ['section', {
      'data-type': 'page-section',
      class: 'grimoire-section',
      ...(columns ? { 'data-columns': String(columns), style: `--section-columns:${columns}` } : {}),
    }, 0]
  },
  addCommands() {
    return {
      insertSectionBreak: () => ({ state, dispatch }) => {
        const { $from } = state.selection
        if ($from.depth < 2) return false
        if (dispatch) {
          const type = state.schema.nodes.section
          const tr = state.tr.split($from.pos, $from.depth, [{ type, attrs: { ...$from.node(1).attrs, auto: false } }])
          const sectionStart = tr.selection.$from
          tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(tr.doc.content.size, sectionStart.pos + 1))))
          dispatch(tr.scrollIntoView())
        }
        return true
      },
      setSectionColumns: (columns) => ({ state, dispatch }) => {
        const { $from } = state.selection
        if ($from.depth < 1) return false
        if (dispatch) dispatch(state.tr.setNodeMarkup($from.before(1), undefined, { ...$from.node(1).attrs, columns }))
        return true
      },
      setPageColumns: ({ start, next, columns }) => ({ state, dispatch }) => {
        const $start = state.doc.resolve(start)
        if ($start.depth !== 1) return false
        const index = $start.index(0)
        const current = $start.node(1)
        if (sectionColumns(current.attrs.columns) === columns) return true
        if (!dispatch) return true
        const type = state.schema.nodes.section
        const startsSection = $start.parentOffset === 0
        const $next = next === null ? null : state.doc.resolve(next)
        const nextInside = !!$next && $next.depth === 1 && $next.index(0) === index && $next.parentOffset > 0
        const tr = state.tr
        // Later positions first, so the earlier ones are not shifted by the split.
        if (nextInside) tr.split(next!, 1, [{ type, attrs: { ...current.attrs, auto: true } }])
        if (startsSection) tr.setNodeMarkup($start.before(1), undefined, { ...current.attrs, columns })
        else tr.split(start, 1, [{ type, attrs: { columns, auto: true } }])
        // Generated sections that no longer differ from their neighbour are not worth keeping.
        const sectionStart = (target: number) => { let pos = 0; for (let i = 0; i < target; i++) pos += tr.doc.child(i).nodeSize; return pos }
        const target = startsSection ? index : index + 1
        const mergeable = (i: number) => i > 0 && i < tr.doc.childCount && tr.doc.child(i).attrs.auto
          && sectionColumns(tr.doc.child(i).attrs.columns) === sectionColumns(tr.doc.child(i - 1).attrs.columns)
        if (mergeable(target + 1) && canJoin(tr.doc, sectionStart(target + 1))) tr.join(sectionStart(target + 1))
        if (mergeable(target) && canJoin(tr.doc, sectionStart(target))) tr.join(sectionStart(target))
        dispatch(tr)
        return true
      },
      mergeSectionWithPrevious: () => ({ state, dispatch }) => {
        const { $from } = state.selection
        const boundary = $from.before(1)
        if ($from.depth < 1 || boundary === 0 || !canJoin(state.doc, boundary)) return false
        if (dispatch) dispatch(state.tr.join(boundary).scrollIntoView())
        return true
      },
    }
  },
  addStorage() {
    return {
      markdown: {
        // Markdown has no sections: a break is an HTML marker line that carries the column choice.
        serialize(state: MarkdownState, node: PMNode, _parent: PMNode, index: number) {
          const columns = sectionColumns(node.attrs.columns)
          if (index > 0 || columns) {
            state.write(`<div data-type="section-break"${columns ? ` data-columns="${columns}"` : ''}${node.attrs.auto ? ' data-auto="true"' : ''}></div>`)
            state.closeBlock(node)
          }
          state.renderContent(node)
        },
        parse: {
          /** Turns the break markers back into sections; a file without markers is left to become one section. */
          updateDOM(element: HTMLElement) {
            if (!element.querySelector(`:scope > ${MARKER}`)) return
            const sections: HTMLElement[] = []
            let current: HTMLElement | null = null
            const start = (columns: string, auto: boolean) => {
              current = document.createElement('section')
              current.dataset.type = 'page-section'
              if (columns) current.dataset.columns = columns
              if (auto) current.dataset.auto = 'true'
              sections.push(current)
            }
            for (const child of Array.from(element.childNodes)) {
              if (child instanceof HTMLElement && child.matches(MARKER)) { start(child.dataset.columns ?? '', child.dataset.auto === 'true'); continue }
              if (!current) {
                if (!child.textContent?.trim() && !(child instanceof HTMLElement)) continue
                start('', false)
              }
              current!.append(child)
            }
            element.replaceChildren(...sections)
          },
        },
      },
    }
  },
})

/** Which section the cursor is in, 1-based, and how many there are. */
export function sectionPosition(doc: PMNode, from: number): { index: number; count: number; columns: SectionColumns } {
  const resolved = doc.resolve(from)
  const index = resolved.depth >= 1 ? resolved.index(0) : 0
  return { index: index + 1, count: doc.childCount, columns: sectionColumns(doc.child(index).attrs.columns) }
}
