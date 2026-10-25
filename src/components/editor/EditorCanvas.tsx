import { useEffect, type MouseEvent } from 'react'
import { TextSelection } from '@tiptap/pm/state'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import { useDocumentStore } from '../../stores/documentStore'
import { emitPluginEvent, setPluginHost } from '../../plugins/plugin-manager'
import { PageView } from './PageView'
import { EDITOR_EXTENSIONS } from './editorExtensions'
import { DocumentPathContext } from './DocumentPathContext'
import { registerSnippetDropTarget } from '../../lib/snippetDrop'
import { insertContentBox } from '../../lib/contentBoxes'

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
    if (target !== editor.view.dom && target.closest('.ProseMirror')) return
    event.preventDefault()
    editor.commands.focus(editor.state.selection instanceof TextSelection ? undefined : 'end', { scrollIntoView: false })
  }

  return (
    <DocumentPathContext value={documentPath}><PageView onPageClick={focusWritingArea} onPagePointerDown={focusWritingArea}>
      <EditorContent editor={editor} className="grimoire-content" />
    </PageView></DocumentPathContext>
  )
}
