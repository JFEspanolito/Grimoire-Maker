import { useCallback, useEffect, useState, type MouseEvent } from 'react'
import { TextSelection } from '@tiptap/pm/state'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import { useDocumentStore } from '../../stores/documentStore'
import { emitPluginEvent, setPluginHost } from '../../plugins/plugin-manager'
import { PageView } from './PageView'
import { EDITOR_EXTENSIONS } from './editorExtensions'
import { DocumentPathContext } from './DocumentPathContext'
import { registerSnippetDropTarget } from '../../lib/snippetDrop'
import { focusDocumentEnd, insertContentBox } from '../../lib/contentBoxes'
import { EditorContextMenu } from './EditorContextMenu'
import { selectionMarkdown } from './selectionMarkdown'
import { SaveSnippetDialog } from '../snippets/SaveSnippetDialog'

function getMarkdown(editor: Editor): string {
  return (editor.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown()
}

interface Props {
  onReady: (editor: Editor) => void
  path?: string | null
  active?: boolean
}

export function EditorCanvas({ onReady, path, active = true }: Props) {
  const body = useDocumentStore((s) => path === undefined ? s.document.body : (s.buffers[path ?? '__untitled__']?.body ?? ''))
  const activePath = useDocumentStore((s) => s.document.path)
  const documentPath = path === undefined ? activePath : path

  const [menu, setMenu] = useState<{ x: number; y: number; markdown: string } | null>(null)
  const [snippetMarkdown, setSnippetMarkdown] = useState<string | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])

  const editor = useEditor({
    extensions: EDITOR_EXTENSIONS,
    content: body,
    onUpdate: ({ editor: e }) => {
      const store = useDocumentStore.getState()
      store.setBodyForPath(path === undefined ? store.document.path : path, getMarkdown(e))
      emitPluginEvent('document:changed')
    },
  })

  useEffect(() => editor ? registerSnippetDropTarget(editor, documentPath ?? null) : undefined, [editor, documentPath])

  useEffect(() => {
    if (!editor || !active) return
    onReady(editor)
    setPluginHost({
      getActiveBody: () => getMarkdown(editor),
      insertContent: (markdown) => insertContentBox(editor, markdown),
    })
    return () => setPluginHost({ getActiveBody: () => '', insertContent: () => {} })
  }, [editor, onReady, active])

  // External body changes (file open) reload the editor; own edits are no-ops.
  useEffect(() => {
    if (editor && getMarkdown(editor) !== body) editor.commands.setContent(body, { emitUpdate: false })
  }, [editor, body])

  const focusWritingArea = (event: MouseEvent<HTMLDivElement>) => {
    if (!editor || event.button !== 0 || !(event.target instanceof Element)) return
    const target = event.target
    if (target.closest('button, input, select, textarea, a, [contenteditable="false"]')) return
    const insideProseMirror = target !== editor.view.dom && !!target.closest('.ProseMirror')
    if (insideProseMirror) {
      // In paginated/column mode, .grimoire-section fills the full column height, so clicking blank space
      // below a trailing content box lands directly on the section or ProseMirror root instead of a child block.
      const isBareContainer = target.classList.contains('grimoire-section') || target.classList.contains('ProseMirror')
      if (!isBareContainer) return
      const lastBox = Array.from(target.querySelectorAll<HTMLElement>(':scope > .grimoire-content-box, :scope > .node-standardContentBox')).at(-1)
      if (!lastBox || event.clientY <= lastBox.getBoundingClientRect().bottom) return
    }
    event.preventDefault()
    const inContentBox = (() => {
      const { $from } = editor.state.selection
      for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type.name === 'standardContentBox') return true
      }
      return false
    })()
    const lastSection = editor.state.doc.lastChild
    const lastBlock = (lastSection?.type.name === 'section' ? lastSection : editor.state.doc).lastChild
    if (inContentBox || (lastBlock && lastBlock.type.name !== 'paragraph')) {
      focusDocumentEnd(editor)
      return
    }
    editor.commands.focus(editor.state.selection instanceof TextSelection ? undefined : 'end', { scrollIntoView: false })
  }

  // With something to save (a selection, or the cursor inside a table/statblock) the right-click
  // offers "Save Selection as Snippet..."; otherwise the native menu and page behaviors stay as they were.
  const openContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    const markdown = editor ? selectionMarkdown(editor) : ''
    if (!markdown) return
    event.preventDefault()
    event.stopPropagation()
    setMenu({ markdown, x: Math.min(event.clientX, window.innerWidth - 220), y: Math.min(event.clientY, window.innerHeight - 56) })
  }

  return (
    <>
      <DocumentPathContext value={documentPath}><PageView onPageClick={focusWritingArea} onPagePointerDown={focusWritingArea}>
        <EditorContent editor={editor} className="grimoire-content" onContextMenu={openContextMenu} />
      </PageView></DocumentPathContext>
      {menu && <EditorContextMenu x={menu.x} y={menu.y} onClose={closeMenu}
        onSaveSnippet={() => setSnippetMarkdown(menu.markdown)} />}
      {snippetMarkdown !== null && <SaveSnippetDialog markdown={snippetMarkdown} onClose={() => setSnippetMarkdown(null)} />}
    </>
  )
}
