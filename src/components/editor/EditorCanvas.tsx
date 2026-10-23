import { useEffect } from 'react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import TextAlign from '@tiptap/extension-text-align'
import { Markdown } from 'tiptap-markdown'
import { useDocumentStore } from '../../stores/documentStore'
import { emitPluginEvent, setPluginHost } from '../../plugins/plugin-manager'
import { CharacterSheet, ReadAloud, Statblock } from './extensions/blocks'
import { GrimoireImageNode } from './extensions/imageNode'
import { TableExtensions } from './extensions/tables'
import { PageView } from './PageView'
import { DocumentPathContext } from './DocumentPathContext'

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
    extensions: [
      StarterKit,
      GrimoireImageNode,
      ...TableExtensions,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Statblock,
      ReadAloud,
      CharacterSheet,
      Markdown.configure({ html: true, tightLists: true, breaks: false }),
    ],
    content: body,
    onUpdate: ({ editor: e }) => {
      const store = useDocumentStore.getState()
      store.setBodyForPath(path === undefined ? store.document.path : path, getMarkdown(e))
      emitPluginEvent('document:changed')
    },
  })

  useEffect(() => {
    if (!editor || !active) return
    onReady(editor)
    setPluginHost({
      getActiveBody: () => getMarkdown(editor),
      insertContent: (markdown) => editor.chain().focus().insertContent(markdown).run(),
    })
    return () => setPluginHost({ getActiveBody: () => '', insertContent: () => {} })
  }, [editor, onReady, active])

  // External body changes (file open) reload the editor; own edits are no-ops.
  useEffect(() => {
    if (editor && getMarkdown(editor) !== body) editor.commands.setContent(body, { emitUpdate: false })
  }, [editor, body])

  return (
    <DocumentPathContext value={documentPath}><PageView onPageClick={(event) => {
      if (event.target instanceof Element && !event.target.closest('.ProseMirror')) {
        editor?.commands.focus(undefined, { scrollIntoView: false })
      }
    }}>
      <EditorContent editor={editor} className="grimoire-content" />
    </PageView></DocumentPathContext>
  )
}
