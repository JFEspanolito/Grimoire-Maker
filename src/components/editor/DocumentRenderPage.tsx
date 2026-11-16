import { EditorContent, useEditor } from '@tiptap/react'
import { EDITOR_EXTENSIONS } from './editorExtensions'

export function DocumentRenderPage({ markdown }: { markdown: string }) {
  const editor = useEditor({ extensions: EDITOR_EXTENSIONS, content: markdown, editable: false })
  return <EditorContent editor={editor} className="grimoire-content" />
}
