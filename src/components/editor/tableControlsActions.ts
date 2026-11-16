import type { Editor } from '@tiptap/react'
import type { Node as PMNode } from '@tiptap/pm/model'

export function findTable(editor: Editor) {
  const { $from } = editor.state.selection
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === 'table') {
      return { node: $from.node(d), pos: $from.before(d), depth: d }
    }
  }
  return null
}

export function findCurrentCellInfo(editor: Editor) {
  const { $from } = editor.state.selection
  let cellNode: PMNode | null = null
  let cellPos = 0
  let rowNode: PMNode | null = null
  let rowPos = 0
  let tablePos = 0
  let tableNode: PMNode | null = null

  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d)
    if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
      cellNode = node
      cellPos = $from.before(d)
    } else if (node.type.name === 'tableRow') {
      rowNode = node
      rowPos = $from.before(d)
    } else if (node.type.name === 'table') {
      tableNode = node
      tablePos = $from.before(d)
    }
  }

  if (!cellNode || !rowNode || !tableNode) return null

  let colIndex = 0
  let currentOffset = 0
  const targetOffset = cellPos - rowPos - 1
  for (let i = 0; i < rowNode.childCount; i++) {
    if (currentOffset >= targetOffset) {
      colIndex = i
      break
    }
    currentOffset += rowNode.child(i).nodeSize
  }

  const colwidth = cellNode.attrs.colwidth as number[] | null
  const currentWidth = colwidth && colwidth.length > 0 ? colwidth[0] : null

  let renderedWidth: number | null = null
  try {
    const dom = editor.view.nodeDOM(cellPos)
    const element = dom instanceof HTMLElement ? dom : (dom instanceof Node ? dom.parentElement : null)
    if (element) {
      const rect = element.getBoundingClientRect()
      if (rect.width > 0) {
        renderedWidth = Math.round(rect.width)
      }
    }
  } catch {
    // In headless test environments getBoundingClientRect may be 0
  }

  return { tableNode, tablePos, colIndex, currentWidth, renderedWidth }
}

export function toggleColumnSpan(editor: Editor): boolean {
  const table = findTable(editor)
  if (!table) return false
  const isSpanAll = table.node.attrs.columnSpan === 'all'
  const nextSpan = isSpanAll ? null : 'all'
  const tr = editor.state.tr.setNodeMarkup(table.pos, undefined, { ...table.node.attrs, columnSpan: nextSpan })
  editor.view.dispatch(tr)
  return true
}

/**
 * Updates column width for all cells in that column.
 * Note: Does not call editor.focus() so typing in width input is never interrupted.
 */
export function setTableColumnWidth(editor: Editor, widthPx: number | null): boolean {
  const info = findCurrentCellInfo(editor)
  if (!info) return false
  const { tableNode, tablePos, colIndex } = info

  const tr = editor.state.tr
  let rowStart = tablePos + 1
  tableNode.forEach((row) => {
    let cellStart = rowStart + 1
    for (let i = 0; i < row.childCount; i++) {
      const cell = row.child(i)
      if (i === colIndex) {
        const colwidth = widthPx !== null && widthPx > 0 ? [Math.round(widthPx)] : null
        tr.setNodeMarkup(cellStart, undefined, { ...cell.attrs, colwidth })
      }
      cellStart += cell.nodeSize
    }
    rowStart += row.nodeSize
  })
  editor.view.dispatch(tr)
  return true
}
