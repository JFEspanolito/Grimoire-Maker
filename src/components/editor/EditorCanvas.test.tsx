import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, expect, it } from 'vitest'
import type { Editor } from '@tiptap/react'
import { useDocumentStore } from '../../stores/documentStore'
import { EditorCanvas } from './EditorCanvas'

let root: Root | null = null
beforeAll(() => Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true))
afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = null
  document.body.replaceChildren()
})

it('does not mark a loaded Markdown file dirty while synchronizing the editor', async () => {
  useDocumentStore.getState().loadFromRaw(null, '')
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)

  await act(async () => root?.render(<EditorCanvas onReady={() => undefined} />))
  await act(async () => useDocumentStore.getState().loadFromRaw('/workspace/Draft/chapter.md', '# Chapter'))

  expect(useDocumentStore.getState().document.dirty).toBe(false)
  expect(container.textContent).toContain('Chapter')
})

it('focuses the editor when a blank sheet margin is clicked', async () => {
  useDocumentStore.getState().loadFromRaw(null, '# Chapter')
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const editors: Editor[] = []
  await act(async () => root?.render(<EditorCanvas onReady={(value) => { editors.push(value) }} />))
  const editor = editors[0]
  const sheet = container.querySelector('.grimoire-page')
  expect(sheet).not.toBeNull()
  expect(editor).toBeDefined()
  editor.view.dom.blur()

  await act(async () => {
    sheet?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 30))
  })

  expect(document.activeElement).toBe(editor.view.dom)
})
