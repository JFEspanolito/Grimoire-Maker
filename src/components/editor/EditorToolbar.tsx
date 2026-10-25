import { useEditorState, type Editor } from '@tiptap/react'
import { ImageControls, type ImageAttrs } from './ImageControls'
import { TableControls } from './TableControls'
import { GuidesMenu } from '../../plugins/builtins/pixel-ruler/GuidesMenu'

interface Action {
  id: string
  label: string
  title: string
  run: (editor: Editor) => void
  isActive?: (editor: Editor) => boolean
  canRun?: (editor: Editor) => boolean
}

const ACTIONS: Action[][] = [
  [
    {
      id: 'undo',
      label: '↶',
      title: 'Undo',
      run: (e) => e.chain().focus().undo().run(),
      canRun: (e) => e.can().undo(),
    },
    {
      id: 'redo',
      label: '↷',
      title: 'Redo',
      run: (e) => e.chain().focus().redo().run(),
      canRun: (e) => e.can().redo(),
    },
  ],
  [
    {
      id: 'bold',
      label: 'B',
      title: 'Bold',
      run: (e) => e.chain().focus().toggleBold().run(),
      isActive: (e) => e.isActive('bold'),
    },
    {
      id: 'italic',
      label: 'I',
      title: 'Italic',
      run: (e) => e.chain().focus().toggleItalic().run(),
      isActive: (e) => e.isActive('italic'),
    },
    {
      id: 'underline',
      label: 'U',
      title: 'Underline',
      run: (e) => e.chain().focus().toggleUnderline().run(),
      isActive: (e) => e.isActive('underline'),
    },
    {
      id: 'strike',
      label: 'S',
      title: 'Strikethrough',
      run: (e) => e.chain().focus().toggleStrike().run(),
      isActive: (e) => e.isActive('strike'),
    },
  ],
  [
    {
      id: 'h1',
      label: 'H1',
      title: 'Heading 1 (starts a new page when printed)',
      run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(),
      isActive: (e) => e.isActive('heading', { level: 1 }),
    },
    {
      id: 'h2',
      label: 'H2',
      title: 'Heading 2',
      run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
      isActive: (e) => e.isActive('heading', { level: 2 }),
    },
    {
      id: 'h3',
      label: 'H3',
      title: 'Heading 3',
      run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
      isActive: (e) => e.isActive('heading', { level: 3 }),
    },
    {
      id: 'paragraph',
      label: '¶',
      title: 'Paragraph',
      run: (e) => e.chain().focus().setParagraph().run(),
      isActive: (e) => e.isActive('paragraph'),
    },
  ],
  [
    {
      id: 'bullet',
      label: '• List',
      title: 'Bulleted list',
      run: (e) => e.chain().focus().toggleBulletList().run(),
      isActive: (e) => e.isActive('bulletList'),
    },
    {
      id: 'ordered',
      label: '1. List',
      title: 'Numbered list',
      run: (e) => e.chain().focus().toggleOrderedList().run(),
      isActive: (e) => e.isActive('orderedList'),
    },
  ],
]

const btn = 'min-w-8 rounded px-2 py-1 text-sm hover:bg-white/10 disabled:opacity-30'

/** Formatting controls for the active editor; each button reflects the current selection. */
export function EditorToolbar({ editor }: { editor: Editor | null }) {
  // Re-evaluates the per-button state on every transaction, so active styling follows the caret.
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            actions: Object.fromEntries(
              ACTIONS.flat().map((a) => [
                a.id,
                { active: a.isActive?.(e) ?? false, enabled: a.canRun?.(e) ?? true },
              ]),
            ),
            image: e.isActive('image') ? (e.getAttributes('image') as ImageAttrs) : null,
            inTable: e.isActive('table'),
          }
        : null,
  })

  return (
    <>
      <div
        role="toolbar"
        aria-label="Formatting"
        className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-white/10 bg-neutral-900 px-3 py-1"
      >
        {ACTIONS.map((group, i) => (
          <div key={i} className="flex items-center gap-0.5">
            {group.map((a) => {
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
            })}
          </div>
        ))}
        <GuidesMenu />
      </div>
      <ImageControls editor={editor} attrs={state?.image ?? null} />
      {editor && state?.inTable && <TableControls editor={editor} />}
    </>
  )
}
