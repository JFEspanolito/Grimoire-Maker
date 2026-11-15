import { useState } from 'react'
import type { Editor } from '@tiptap/react'
import { useEditorState } from '@tiptap/react'
import { findCurrentCellInfo, setTableColumnWidth, toggleColumnSpan } from './tableControlsActions'
import { useTranslation, type TranslationKey } from '../../lib/i18n'

interface ActionDef {
  label: string
  titleKey: TranslationKey
  run: (editor: Editor) => boolean
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

  const [widthSource, setWidthSource] = useState({ width: cellInfo?.currentWidth, column: cellInfo?.colIndex })
  if (widthSource.width !== cellInfo?.currentWidth || widthSource.column !== cellInfo?.colIndex) {
    setWidthSource({ width: cellInfo?.currentWidth, column: cellInfo?.colIndex })
    setWidthInput(cellInfo?.currentWidth ? String(cellInfo.currentWidth) : '')
  }

  const applyWidth = (value: string) => {
    setWidthInput(value)
    const parsed = parseInt(value, 10)
    if (!isNaN(parsed) && parsed >= 25 && parsed <= 2000) {
      setTableColumnWidth(editor, parsed)
    } else if (value.trim() === '') {
      setTableColumnWidth(editor, null)
    }
  }

  const stepWidth = (delta: number) => {
    const base = cellInfo?.currentWidth ?? cellInfo?.renderedWidth ?? 100
    const next = Math.max(25, Math.min(2000, base + delta))
    applyWidth(String(next))
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
      <div className="flex items-center gap-1 text-xs text-white/70" title={t('table.colWidth')}>
        <span>W:</span>
        <button
          type="button"
          title="-1 px"
          aria-label="-1 px"
          className="flex h-5 w-5 items-center justify-center rounded bg-white/10 text-xs font-semibold text-white hover:bg-white/20 active:bg-white/30"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => stepWidth(-1)}
        >
          -
        </button>
        <input
          type="number"
          min="25"
          max="2000"
          placeholder={cellInfo?.renderedWidth ? `Auto (${cellInfo.renderedWidth})` : 'Auto'}
          value={widthInput}
          aria-label={t('table.colWidth')}
          title={t('table.colWidth')}
          className="w-14 rounded bg-white/10 px-1 py-0.5 text-xs text-white placeholder-white/40 focus:bg-white/20 focus:outline-none"
          onMouseDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              stepWidth(e.shiftKey ? 10 : 1)
            } else if (e.key === 'ArrowDown') {
              e.preventDefault()
              stepWidth(e.shiftKey ? -10 : -1)
            }
          }}
          onChange={(e) => {
            const val = e.target.value
            if (widthInput === '' && (val === '0' || val === '1' || val === '25')) {
              const base = cellInfo?.renderedWidth ?? 100
              const adjusted = val === '0' ? base - 1 : base + 1
              applyWidth(String(Math.max(25, adjusted)))
              return
            }
            applyWidth(val)
          }}
        />
        <button
          type="button"
          title="+1 px"
          aria-label="+1 px"
          className="flex h-5 w-5 items-center justify-center rounded bg-white/10 text-xs font-semibold text-white hover:bg-white/20 active:bg-white/30"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => stepWidth(1)}
        >
          +
        </button>
        <span>px</span>
        <button
          type="button"
          title={t('table.resetColWidth')}
          aria-label={t('table.resetColWidth')}
          className="rounded px-1.5 py-0.5 text-xs text-white/50 hover:bg-white/10 hover:text-white"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setWidthInput('')
            setTableColumnWidth(editor, null)
          }}
        >
          Auto
        </button>
      </div>

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
