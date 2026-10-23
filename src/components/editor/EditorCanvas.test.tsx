import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, expect, it } from 'vitest'
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
