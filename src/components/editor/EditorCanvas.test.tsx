import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import type { Editor } from '@tiptap/react'
import { useDocumentStore } from '../../stores/documentStore'
import { EditorCanvas } from './EditorCanvas'

vi.mock('../../lib/images', () => ({
  loadImageUrl: vi.fn(async () => 'blob:map'),
  revokeImageUrl: vi.fn(),
}))

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

it('drags an image within the sheet and stores the new position in Markdown', async () => {
  useDocumentStore.getState().loadFromRaw('/workspace/Draft/chapter.md', '![Map](assets/map.png)')
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root?.render(<EditorCanvas onReady={() => undefined} />))
  const page = container.querySelector<HTMLElement>('.grimoire-page')!
  const image = container.querySelector<HTMLImageElement>('.grimoire-image img')!
  expect(image).toBeDefined()
  vi.spyOn(page, 'getBoundingClientRect').mockReturnValue({
    left: 0, top: 0, width: 420, height: 594,
  } as DOMRect)
  vi.spyOn(image, 'getBoundingClientRect').mockReturnValue({
    left: 60, top: 80, width: 80, height: 100,
  } as DOMRect)
  const pointer = (type: string, x: number, y: number) => {
    const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 })
    Object.defineProperty(event, 'pointerId', { value: 1 })
    return event
  }

  await act(async () => image.dispatchEvent(pointer('pointerdown', 60, 80)))
  await act(async () => window.dispatchEvent(pointer('pointerup', 60, 80)))
  expect(useDocumentStore.getState().document.body).not.toContain('data-anchor="free"')

  await act(async () => image.dispatchEvent(pointer('pointerdown', 60, 80)))
  await act(async () => window.dispatchEvent(pointer('pointermove', 100, 140)))
  await act(async () => window.dispatchEvent(pointer('pointerup', 100, 140)))

  expect(useDocumentStore.getState().document.body).toContain('data-anchor="free"')
  expect(useDocumentStore.getState().document.body).toContain('data-x-mm="50"')
  expect(useDocumentStore.getState().document.body).toContain('data-y-mm="70"')
})
