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

function getMarkdown(editor: Editor): string {
  return (editor.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown()
}

interface Props {
  onReady: (editor: Editor) => void
}

export function EditorCanvas({ onReady }: Props) {
  const body = useDocumentStore((s) => s.document.body)
  const setBody = useDocumentStore((s) => s.setBody)

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
      setBody(getMarkdown(e))
      emitPluginEvent('document:changed')
    },
  })

  useEffect(() => {
    if (!editor) return
    onReady(editor)
    setPluginHost({
      getActiveBody: () => getMarkdown(editor),
      insertContent: (markdown) => editor.chain().focus().insertContent(markdown).run(),
    })
  }, [editor, onReady])

  // External body changes (file open) reload the editor; own edits are no-ops.
  useEffect(() => {
    if (editor && getMarkdown(editor) !== body) editor.commands.setContent(body, { emitUpdate: false })
  }, [editor, body])

  return (
    <PageView>
      <EditorContent editor={editor} className="grimoire-content" />
    </PageView>
  )
}
