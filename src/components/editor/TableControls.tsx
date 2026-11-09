import { useState, useEffect } from 'react'
import type { Editor } from '@tiptap/react'
import { useEditorState } from '@tiptap/react'
import type { Node as PMNode } from '@tiptap/pm/model'
import { useTranslation, type TranslationKey } from '../../lib/i18n'

interface ActionDef {
  label: string
  titleKey: TranslationKey
  run: (editor: Editor) => boolean
}

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

  return { tableNode, tablePos, colIndex, currentWidth }
}

export function toggleColumnSpan(editor: Editor): boolean {
  const table = findTable(editor)
  if (!table) return false
  const isSpanAll = table.node.attrs.columnSpan === 'all'
  const nextSpan = isSpanAll ? null : 'all'
  return editor.chain().focus().command(({ tr }) => {
    tr.setNodeMarkup(table.pos, undefined, { ...table.node.attrs, columnSpan: nextSpan })
    return true
  }).run()
}

export function setTableColumnWidth(editor: Editor, widthPx: number | null): boolean {
  const info = findCurrentCellInfo(editor)
  if (!info) return false
  const { tableNode, tablePos, colIndex } = info

  return editor.chain().focus().command(({ tr }) => {
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
    return true
  }).run()
}

const GROUPS: ActionDef[][] = [
  [
    { label: '↑ Row', titleKey: 'table.addRowAbove', run: (e) => e.chain().focus().addRowBefore().run() },
    { label: '↓ Row', titleKey: 'table.addRowBelow', run: (e) => e.chain().focus().addRowAfter().run() },
    { label: '✕ Row', titleKey: 'table.deleteRow', run: (e) => e.chain().focus().deleteRow().run() },
  ],
  [
    { label: '← Col', titleKey: 'table.addColLeft', run: (e) => e.chain().focus().addColumnBefore().run() },
    { label: '→ Col', titleKey: 'table.addColRight', run: (e) => e.chain().focus().addColumnAfter().run() },
    { label: '✕ Col', titleKey: 'table.deleteCol', run: (e) => e.chain().focus().deleteColumn().run() },
  ],
]

const btn = 'rounded px-2 py-1 text-sm hover:bg-white/10'

/** Row and column controls, shown while the caret is inside a table. */
export function TableControls({ editor }: { editor: Editor }) {
  const { t } = useTranslation()
  const cellInfo = useEditorState({
    editor,
    selector: ({ editor: e }) => findCurrentCellInfo(e),
  })
  const isSpanAll = cellInfo?.tableNode.attrs.columnSpan === 'all'
  const [widthInput, setWidthInput] = useState<string>(cellInfo?.currentWidth ? String(cellInfo.currentWidth) : '')

  useEffect(() => {
    setWidthInput(cellInfo?.currentWidth ? String(cellInfo.currentWidth) : '')
  }, [cellInfo?.currentWidth, cellInfo?.colIndex])

  const applyWidth = (value: string) => {
    setWidthInput(value)
    const parsed = parseInt(value, 10)
    if (!isNaN(parsed) && parsed >= 25 && parsed <= 2000) {
      setTableColumnWidth(editor, parsed)
    } else if (value.trim() === '') {
      setTableColumnWidth(editor, null)
    }
  }

  return (
    <div
      role="group"
      aria-label={t('table.title')}
      className="flex min-h-9 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-white/10 bg-neutral-900 px-3 py-1"
    >
      <span className="text-xs text-white/60">{t('table.title')}</span>
      {GROUPS.map((group, i) => (
        <div key={i} className="flex items-center gap-0.5">
          {group.map((a) => {
            const title = t(a.titleKey)
            return (
              <button
                key={a.titleKey}
                type="button"
                title={title}
                aria-label={title}
                className={btn}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => a.run(editor)}
              >
                {a.label}
              </button>
            )
          })}
        </div>
      ))}

      {/* Column Span toggle */}
      <button
        type="button"
        title={t('table.spanAll')}
        aria-label={t('table.spanAll')}
        aria-pressed={isSpanAll}
        className={`${btn} ${isSpanAll ? 'bg-white/20 text-yellow-300 ring-1 ring-yellow-400/50' : ''}`}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => toggleColumnSpan(editor)}
      >
        ⇿ {t('table.spanAll')}
      </button>

      {/* Individual Column Width */}
      <label className="flex items-center gap-1 text-xs text-white/70" title={t('table.colWidth')}>
        <span>W:</span>
        <input
          type="number"
          min="25"
          max="2000"
          placeholder="Auto"
          value={widthInput}
          aria-label={t('table.colWidth')}
          title={t('table.colWidth')}
          className="w-14 rounded bg-white/10 px-1 py-0.5 text-xs text-white placeholder-white/30 focus:bg-white/20 focus:outline-none"
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => applyWidth(e.target.value)}
        />
        <span>px</span>
        <button
          type="button"
          title={t('table.resetColWidth')}
          aria-label={t('table.resetColWidth')}
          className="rounded px-1 text-xs text-white/50 hover:bg-white/10 hover:text-white"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setWidthInput('')
            setTableColumnWidth(editor, null)
          }}
        >
          Auto
        </button>
      </label>

      {/* Delete Table */}
      <button
        type="button"
        title={t('table.deleteTable')}
        aria-label={t('table.deleteTable')}
        className={`${btn} text-red-400 hover:text-red-300`}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => editor.chain().focus().deleteTable().run()}
      >
        ✕ {t('table.title')}
      </button>
    </div>
  )
}
