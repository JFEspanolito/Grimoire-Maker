import { useSettingsStore } from '../../stores/settingsStore'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Editor } from '@tiptap/react'
import { expect, it, vi } from 'vitest'
import { DocumentWorkspace } from './DocumentWorkspace'
import { useDocumentStore } from '../../stores/documentStore'
import { useTabStore } from '../../stores/tabStore'

vi.mock('../viewers/FilePreview', () => ({ FilePreview: ({ path }: { path: string }) => <div>Preview: {path}</div> }))

it('mounts a read-only preview beside Markdown without a binary editor buffer', async () => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  const documents = useDocumentStore.getState()
  documents.resetDocuments()
  documents.loadFromRaw('/a.md', 'Alpha')
  const tabs = useTabStore.getState()
  tabs.reset('/a.md')
  tabs.open('/reference.pdf', true)
  documents.deactivate()
  tabs.toggleSplit()
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    await act(async () => root.render(<DocumentWorkspace editor={null} onReady={() => {}} />))
    expect(container.querySelectorAll('.ProseMirror')).toHaveLength(1)
    expect(container.textContent).toContain('Preview: /reference.pdf')
    expect(container.querySelector('[data-active-editor="true"]')).toBeNull()
    expect(documents.buffers['/reference.pdf']).toBeUndefined()
    await act(async () => container.querySelector('[aria-label="Editor 2"]')?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })))
    expect(useDocumentStore.getState().document.path).toBe('/a.md')
    await act(async () => container.querySelector('[aria-label="Editor 1"]')?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })))
    expect(useDocumentStore.getState().document.path).toBeNull()
    expect(useDocumentStore.getState().buffers['/a.md'].body).toBe('Alpha')
  } finally {
    await act(async () => root.unmount())
    tabs.reset(null)
    documents.resetDocuments()
  }
})

it('edits two independent mounted documents and retains each undo history', async () => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  const documents = useDocumentStore.getState()
  documents.resetDocuments()
  documents.loadFromRaw('/a.md', 'Alpha')
  documents.loadFromRaw('/b.md', 'Beta')
  const tabs = useTabStore.getState()
  tabs.reset('/a.md')
  tabs.open('/b.md', true)
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

it('keeps the same live editor and undo history when switching to spread', async () => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  const documents = useDocumentStore.getState()
  documents.loadFromRaw('/spread.md', 'Original text')
  useTabStore.getState().reset('/spread.md')
  useSettingsStore.setState({ viewMode: 'edit' })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  let editor: Editor | null = null
  try {
    await act(async () => root.render(<DocumentWorkspace editor={null} onReady={value => { editor = value }} />))
    const dom = container.querySelector('.ProseMirror')
    await act(async () => useSettingsStore.getState().setViewMode('spreads'))
    expect(container.querySelector('.ProseMirror')).toBe(dom)
    expect(container.querySelector('[hidden] .ProseMirror')).toBeNull()
    await act(async () => editor?.commands.insertContent('spread edit'))
    expect(useDocumentStore.getState().document.body).toContain('spread edit')
    await act(async () => useSettingsStore.getState().setViewMode('edit'))
    expect(container.querySelector('.ProseMirror')).toBe(dom)
    await act(async () => editor?.commands.undo())
    expect(useDocumentStore.getState().document.body).toBe('Original text')
  } finally {
    await act(async () => root.unmount()); container.remove()
    useTabStore.getState().reset(null); documents.resetDocuments(); useSettingsStore.setState({ viewMode: 'edit' })
  }
})
