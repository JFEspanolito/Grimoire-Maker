import type { Editor } from '@tiptap/react'
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
  [{ label: '✕ Table', titleKey: 'table.deleteTable', run: (e) => e.chain().focus().deleteTable().run() }],
]

const btn = 'rounded px-2 py-1 text-sm hover:bg-white/10'

/** Row and column controls, shown while the caret is inside a table. */
export function TableControls({ editor }: { editor: Editor }) {
  const { t } = useTranslation()
  return (
    <div
      role="group"
      aria-label={t('table.title')}
      className="flex min-h-9 shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-white/10 bg-neutral-900 px-3 py-1"
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
    </div>
  )
}
