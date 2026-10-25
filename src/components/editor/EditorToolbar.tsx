import { Fragment, useState } from 'react'
import { useEditorState, type Editor } from '@tiptap/react'
import { ImageControls, type ImageAttrs } from './ImageControls'
import { TableControls } from './TableControls'
import { FindReplaceDialog } from './FindReplaceDialog'
import { canChangeIndent, changeIndent } from './extensions/blockFormat'
import { GuidesMenu } from '../../plugins/builtins/pixel-ruler/GuidesMenu'

interface Action {
  id: string
  label: string
  title: string
  run: (editor: Editor) => void
  isActive?: (editor: Editor) => boolean
  canRun?: (editor: Editor) => boolean
}

const heading = (level: 1 | 2 | 3 | 4, title = `Heading ${level}`): Action => ({
  id: `h${level}`,
  label: `H${level}`,
  title,
  run: (e) => e.chain().focus().toggleHeading({ level }).run(),
  isActive: (e) => e.isActive('heading', { level }),
})

const ACTION_LIST: Action[] = [
  { id: 'undo', label: '↶', title: 'Undo', run: (e) => e.chain().focus().undo().run(), canRun: (e) => e.can().undo() },
  { id: 'redo', label: '↷', title: 'Redo', run: (e) => e.chain().focus().redo().run(), canRun: (e) => e.can().redo() },
  { id: 'bold', label: 'B', title: 'Bold', run: (e) => e.chain().focus().toggleBold().run(), isActive: (e) => e.isActive('bold') },
  { id: 'italic', label: 'I', title: 'Italic', run: (e) => e.chain().focus().toggleItalic().run(), isActive: (e) => e.isActive('italic') },
  { id: 'underline', label: 'U', title: 'Underline', run: (e) => e.chain().focus().toggleUnderline().run(), isActive: (e) => e.isActive('underline') },
  { id: 'strike', label: 'S', title: 'Strikethrough', run: (e) => e.chain().focus().toggleStrike().run(), isActive: (e) => e.isActive('strike') },
  heading(1, 'Heading 1 (starts a new page when printed)'),
  heading(2),
  heading(3),
  heading(4),
  { id: 'outdent', label: '⇤', title: 'Decrease indent', run: (e) => changeIndent(e, -1), canRun: (e) => canChangeIndent(e, -1) },
  { id: 'indent', label: '⇥', title: 'Increase indent', run: (e) => changeIndent(e, 1), canRun: (e) => canChangeIndent(e, 1) },
  { id: 'bullet', label: '• List', title: 'Bulleted list', run: (e) => e.chain().focus().toggleBulletList().run(), isActive: (e) => e.isActive('bulletList') },
  { id: 'ordered', label: '1. List', title: 'Numbered list', run: (e) => e.chain().focus().toggleOrderedList().run(), isActive: (e) => e.isActive('orderedList') },
]
const ACTIONS: Record<string, Action> = Object.fromEntries(ACTION_LIST.map((action) => [action.id, action]))

const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48]
const ALIGNMENTS = [['left', 'Left'], ['center', 'Centered'], ['right', 'Right'], ['justify', 'Justified']] as const

type Group = string[] | 'format' | 'structure' | 'tools'
/** Groups in order; a thin divider separates them. Controls with their own widget sit in named groups. */
const LAYOUT: Group[] = [['undo', 'redo'], ['bold', 'italic', 'underline', 'strike'], 'format', 'structure', ['outdent', 'indent', 'bullet', 'ordered'], 'tools']

const btn = 'min-w-8 rounded px-2 py-1 text-sm hover:bg-white/10 disabled:opacity-30'
const control = 'rounded bg-white/10 px-1 py-0.5 text-sm text-white'

const toHex = (value: string | null | undefined): string => {
  if (!value) return '#000000'
  if (/^#[\da-f]{6}$/i.test(value)) return value.toLowerCase()
  const parts = value.match(/\d+/g)?.slice(0, 3).map(Number)
  return parts?.length === 3 ? `#${parts.map((part) => part.toString(16).padStart(2, '0')).join('')}` : '#000000'
}

/** What the page really draws at the caret, for text that has no explicit color or size. */
function computedStyleAtCaret(editor: Editor): CSSStyleDeclaration | null {
  try {
    const { node } = editor.view.domAtPos(editor.state.selection.from)
    const element = node instanceof Element ? node : node.parentElement
    return element ? getComputedStyle(element) : null
  } catch {
    return null
  }
}

/** Formatting controls for the active editor; each button reflects the current selection. */
export function EditorToolbar({ editor }: { editor: Editor | null }) {
  const [finding, setFinding] = useState(false)
  // Re-evaluates the per-button state on every transaction, so active styling follows the caret.
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e) return null
      const textStyle = e.getAttributes('textStyle') as { color?: string; fontSize?: string }
      const computed = computedStyleAtCaret(e)
      const block = e.isActive('heading') ? 'heading' : 'paragraph'
      return {
        actions: Object.fromEntries(
          ACTION_LIST.map((a) => [a.id, { active: a.isActive?.(e) ?? false, enabled: a.canRun?.(e) ?? true }]),
        ),
        color: toHex(textStyle.color ?? computed?.color),
        size: Math.round(parseFloat(textStyle.fontSize ?? computed?.fontSize ?? '') || 0),
        align: String((e.getAttributes(block) as { textAlign?: string }).textAlign ?? 'left'),
        image: e.isActive('image') ? (e.getAttributes('image') as ImageAttrs) : null,
        inTable: e.isActive('table'),
      }
    },
  })

  const actionButton = (id: string) => {
    const a = ACTIONS[id]
    const current = state?.actions[a.id]
    return (
      <button
        key={a.id}
        type="button"
        title={a.title}
        aria-label={a.title}
        aria-pressed={a.isActive ? (current?.active ?? false) : undefined}
        disabled={!editor || !(current?.enabled ?? true)}
        className={`${btn} ${current?.active ? 'bg-white/20' : ''} ${
          a.id === 'bold' ? 'font-bold' : a.id === 'italic' ? 'italic' : a.id === 'underline' ? 'underline' : ''
        }`}
        // Keep the editor selection: a button press must not steal focus first.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => editor && a.run(editor)}
      >
        {a.label}
      </button>
    )
  }

  const sizes = state?.size && !FONT_SIZES.includes(state.size) ? [...FONT_SIZES, state.size].sort((a, b) => a - b) : FONT_SIZES

  const sections = {
    format: <div className="flex items-center gap-1">
      <input type="color" aria-label="Text color" title="Text color" disabled={!editor} value={state?.color ?? '#000000'}
        className="h-6 w-7 cursor-pointer rounded bg-transparent p-0 disabled:opacity-30"
        onChange={(event) => editor?.chain().focus().setColor(event.target.value).run()} />
      <select aria-label="Text size" title="Text size" disabled={!editor} className={control} value={state?.size || ''}
        onChange={(event) => editor?.chain().focus().setFontSize(`${event.target.value}px`).run()}>
        {!state?.size && <option value="" className="text-black">Size</option>}
        {sizes.map((size) => <option key={size} value={size} className="text-black">{size}px</option>)}
      </select>
    </div>,
    structure: <div className="flex items-center gap-1">
      <select aria-label="Alignment" title="Alignment" disabled={!editor} className={control} value={state?.align ?? 'left'}
        onChange={(event) => editor?.chain().focus().setTextAlign(event.target.value).run()}>
        {ALIGNMENTS.map(([value, label]) => <option key={value} value={value} className="text-black">{label}</option>)}
      </select>
      <div className="flex items-center gap-0.5">{['h1', 'h2', 'h3', 'h4'].map(actionButton)}</div>
    </div>,
    tools: <div className="flex items-center gap-1">
      <GuidesMenu />
      <button type="button" className={btn} disabled={!editor} title="Find and replace" aria-label="Find and replace"
        onMouseDown={(e) => e.preventDefault()} onClick={() => setFinding(true)}>Find</button>
    </div>,
  }

  return (
    <>
      <div
        role="toolbar"
        aria-label="Formatting"
        className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-white/10 bg-neutral-900 px-3 py-1"
      >
        {LAYOUT.map((group, index) => (
          <Fragment key={index}>
            {index > 0 && <span role="separator" aria-orientation="vertical" className="mx-1 h-5 w-px bg-white/15" />}
            {Array.isArray(group) ? <div className="flex items-center gap-0.5">{group.map(actionButton)}</div> : sections[group]}
          </Fragment>
        ))}
      </div>
      {/* One context row: table tools take over the image row's slot, so the layout never grows. */}
      {editor && state?.inTable && !state.image
        ? <TableControls editor={editor} />
        : <ImageControls editor={editor} attrs={state?.image ?? null} />}
      {finding && editor && <FindReplaceDialog editor={editor} onClose={() => setFinding(false)} />}
    </>
  )
}
