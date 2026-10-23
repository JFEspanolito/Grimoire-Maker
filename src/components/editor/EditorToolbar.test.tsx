import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { useDocumentStore } from '../../stores/documentStore'
import { importImage } from '../../lib/images'
import { EditorToolbar } from './EditorToolbar'

const saveFile = vi.hoisted(() => vi.fn())
vi.mock('../../hooks/useFileSystem', () => ({ useFileSystem: () => ({ saveFile }) }))
vi.mock('../../lib/images', () => ({ importImage: vi.fn() }))

let root: Root | null = null
let editor: Editor | null = null
beforeAll(() => Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true))

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = null
  editor?.destroy()
  editor = null
  useDocumentStore.getState().loadFromRaw(null, '')
  vi.clearAllMocks()
})

describe('image insertion', () => {
  it('asks to save an unsaved document instead of opening a Markdown picker as if it were the image picker', async () => {
    useDocumentStore.getState().loadFromRaw(null, '')
    editor = new Editor({ element: document.createElement('div'), extensions: [StarterKit] })
    const container = document.createElement('div')
    root = createRoot(container)
    await act(async () => root?.render(<EditorToolbar editor={editor} />))

    await act(async () => container.querySelector<HTMLButtonElement>('button[title^="Insert image"]')?.click())

    expect(container.textContent).toContain('Save this document as Markdown before importing an image.')
    expect(saveFile).not.toHaveBeenCalled()
    expect(importImage).not.toHaveBeenCalled()
  })

  it('opens the image picker for a saved document', async () => {
    useDocumentStore.getState().loadFromRaw('/workspace/Draft/Chapter.md', '')
    vi.mocked(importImage).mockResolvedValue(null)
    editor = new Editor({ element: document.createElement('div'), extensions: [StarterKit] })
    const container = document.createElement('div')
    root = createRoot(container)
    await act(async () => root?.render(<EditorToolbar editor={editor} />))

    await act(async () => container.querySelector<HTMLButtonElement>('button[title^="Insert image"]')?.click())

    expect(importImage).toHaveBeenCalledWith('/workspace/Draft/Chapter.md')
    expect(saveFile).not.toHaveBeenCalled()
  })
})
