import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Fragment } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import { getHTMLFromFragment, mergeAttributes } from '@tiptap/react'

export interface MarkdownSerializerState {
  write(text: string): void
  closeBlock(node: PMNode): void
  ensureNewLine(): void
  renderInline(node: PMNode): void
  inTable?: boolean
}

export function hasCustomTableLayout(node: PMNode): boolean {
  if (node.attrs.columnSpan === 'all') return true
  let custom = false
  node.forEach((row) => {
    row.forEach((cell) => {
      if (cell.attrs.colwidth && Array.isArray(cell.attrs.colwidth) && cell.attrs.colwidth.length > 0) {
        custom = true
      }
    })
  })
  return custom
}

/**
 * Tables are stored as GFM Markdown when unstyled (so encounter and loot tables stay
 * readable anywhere), or as HTML when carrying layout (column-span across multi-column pages,
 * or custom individual column widths).
 */
export const GrimoireTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      columnSpan: {
        default: null,
        parseHTML: (element: HTMLElement) => (element.getAttribute('data-column-span') === 'all' || element.style.columnSpan === 'all' ? 'all' : null),
        renderHTML: (attributes: Record<string, unknown>) => {
          if (attributes.columnSpan === 'all') {
            return {
              'data-column-span': 'all',
              style: 'column-span: all;',
            }
          }
          return {}
        },
      },
    }
  },
  renderHTML({ node, HTMLAttributes }) {
    const parentRender = this.parent?.({ node, HTMLAttributes })
    if (Array.isArray(parentRender) && parentRender.length >= 2 && typeof parentRender[1] === 'object') {
      const merged = mergeAttributes(parentRender[1] as Record<string, unknown>, {
        ...(node.attrs.columnSpan === 'all' ? { 'data-column-span': 'all', style: 'column-span: all;' } : {}),
      })
      return [parentRender[0], merged, ...parentRender.slice(2)]
    }
    return ['table', mergeAttributes(HTMLAttributes, {
      ...(node.attrs.columnSpan === 'all' ? { 'data-column-span': 'all', style: 'column-span: all;' } : {}),
    }), 0]
  },
  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      ArrowDown: () => {
        const { state, view } = this.editor
        const { selection, schema } = state
        if (!schema.nodes.paragraph) return false
        const { $from } = selection
        let tableDepth = 0
        for (let d = $from.depth; d > 0; d--) {
          if ($from.node(d).type.name === 'table') { tableDepth = d; break }
        }
        if (!tableDepth) return false
        const tableEnd = $from.end(tableDepth)
        if ($from.pos < tableEnd - 2) return false
        const afterTable = $from.after(tableDepth)
        const $after = state.doc.resolve(afterTable)
        if ($after.nodeAfter && $after.nodeAfter.type.name === 'paragraph') {
          const nextSelection = TextSelection.findFrom($after, 1)
          if (nextSelection) {
            view.dispatch(state.tr.setSelection(nextSelection).scrollIntoView())
            return true
          }
        }
        const tr = state.tr.insert(afterTable, schema.nodes.paragraph.create())
        tr.setSelection(TextSelection.create(tr.doc, afterTable + 1)).scrollIntoView()
        view.dispatch(tr)
        return true
      },
    }
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: PMNode) {
          if (hasCustomTableLayout(node)) {
            state.write(getHTMLFromFragment(Fragment.from(node), node.type.schema))
            state.closeBlock(node)
            return
          }
          state.inTable = true
          node.forEach((row, _p, i) => {
            state.write('| ')
            row.forEach((col, _p2, j) => {
              if (j) state.write(' | ')
              const cellContent = col.firstChild
              if (cellContent && cellContent.textContent.trim()) {
                state.renderInline(cellContent)
              }
            })
            state.write(' |')
            state.ensureNewLine()
            if (!i) {
              const delimiterRow = Array.from({ length: row.childCount }, () => '---')
              state.write(`| ${delimiterRow.join(' | ')} |`)
              state.ensureNewLine()
            }
          })
          state.inTable = false
          state.closeBlock(node)
        },
        parse: {},
      },
    }
  },
})

export const TableExtensions = [
  GrimoireTable.configure({ resizable: true, lastColumnResizable: true, cellMinWidth: 25 }),
  TableRow,
  TableHeader,
  TableCell,
]

function cell(type: 'tableHeader' | 'tableCell', text?: string): object {
  return {
    type,
    content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : undefined }],
  }
}

/**
 * A table with a header row and `rows` body rows, as editor JSON. `values[row][col]`
 * pre-fills cells (roll numbers, default scores); every other cell stays empty.
 */
export function buildTable(headers: string[], rows: number, values: string[][] = []): object {
  return {
    type: 'table',
    content: [
      { type: 'tableRow', content: headers.map((h) => cell('tableHeader', h)) },
      ...Array.from({ length: rows }, (_, row) => ({
        type: 'tableRow',
        content: headers.map((_, col) => cell('tableCell', values[row]?.[col])),
      })),
    ],
  }
}
