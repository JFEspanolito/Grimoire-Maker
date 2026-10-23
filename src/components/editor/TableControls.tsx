import type { Editor } from '@tiptap/react'

interface Action {
  label: string
  title: string
  run: (editor: Editor) => boolean
}

const GROUPS: Action[][] = [
  [
    { label: '↑ Row', title: 'Add row above', run: (e) => e.chain().focus().addRowBefore().run() },
    { label: '↓ Row', title: 'Add row below', run: (e) => e.chain().focus().addRowAfter().run() },
    { label: '✕ Row', title: 'Delete row', run: (e) => e.chain().focus().deleteRow().run() },
  ],
  [
    { label: '← Col', title: 'Add column left', run: (e) => e.chain().focus().addColumnBefore().run() },
    { label: '→ Col', title: 'Add column right', run: (e) => e.chain().focus().addColumnAfter().run() },
    { label: '✕ Col', title: 'Delete column', run: (e) => e.chain().focus().deleteColumn().run() },
  ],
  [{ label: '✕ Table', title: 'Delete table', run: (e) => e.chain().focus().deleteTable().run() }],
]

const btn = 'rounded px-2 py-1 text-sm hover:bg-white/10'

/** Row and column controls, shown while the caret is inside a table. */
export function TableControls({ editor }: { editor: Editor }) {
  return (
    <div
      role="group"
      aria-label="Table"
      className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-white/10 bg-neutral-900 px-3 py-1"
    >
      <span className="text-xs text-white/60">Table</span>
      {GROUPS.map((group, i) => (
        <div key={i} className="flex items-center gap-0.5">
          {group.map((a) => (
            <button
              key={a.title}
              type="button"
              title={a.title}
              aria-label={a.title}
              className={btn}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => a.run(editor)}
            >
              {a.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}
