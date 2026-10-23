import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Editor } from '@tiptap/react'
import { expect, it } from 'vitest'
import { DocumentWorkspace } from './DocumentWorkspace'
import { useDocumentStore } from '../../stores/documentStore'
import { useTabStore } from '../../stores/tabStore'

it('edits two independent mounted documents and retains each undo history', async () => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  const documents = useDocumentStore.getState()
  documents.resetDocuments()
  documents.loadFromRaw('/a.md', 'Alpha')
  documents.loadFromRaw('/b.md', 'Beta')
  const tabs = useTabStore.getState()
  tabs.reset('/a.md')
  tabs.open('/b.md')
  tabs.toggleSplit()
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  let editor: Editor | null = null
  const ready = (value: Editor) => { editor = value }
  try {
    await act(async () => root.render(<DocumentWorkspace editor={null} onReady={ready} />))
    expect(container.querySelectorAll('.ProseMirror')).toHaveLength(2)
    await act(async () => editor?.commands.insertContent('right edit'))
    expect(useDocumentStore.getState().buffers['/b.md'].body).toContain('right edit')
    expect(useDocumentStore.getState().buffers['/a.md'].body).toBe('Alpha')
    const first = editor
    await act(async () => {
      tabs.focusPane(1)
      documents.activate('/a.md')
    })
    expect(editor).not.toBe(first)
    await act(async () => editor?.commands.insertContent('left edit'))
    expect(useDocumentStore.getState().buffers['/a.md'].body).toContain('left edit')
    await act(async () => { tabs.focusPane(0); documents.activate('/b.md') })
    expect(editor).toBe(first)
    await act(async () => editor?.commands.undo())
    expect(useDocumentStore.getState().buffers['/b.md'].body).toBe('Beta')
    expect(useDocumentStore.getState().buffers['/a.md'].body).toContain('left edit')
  } finally {
    await act(async () => root.unmount())
    container.remove()
    tabs.reset(null)
    documents.resetDocuments()
  }
})
