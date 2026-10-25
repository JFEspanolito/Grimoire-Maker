import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Editor } from '@tiptap/react'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { EDITOR_EXTENSIONS } from './editorExtensions'
import { EditorToolbar } from './EditorToolbar'

let editor: Editor | null = null
beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: vi.fn() })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: vi.fn() })
})
afterEach(() => { editor?.destroy(); editor = null })

async function open(content: string) {
  editor = new Editor({ extensions: EDITOR_EXTENSIONS, content })
  const container = document.createElement('div')
  const root = createRoot(container)
  await act(async () => root.render(<EditorToolbar editor={editor} />))
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Find and replace"]')!.click())
  const inputs = container.querySelectorAll<HTMLInputElement>('dialog input:not([type])')
  const set = (input: HTMLInputElement, value: string) => act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const click = (label: string) => act(async () => Array.from(container.querySelectorAll<HTMLButtonElement>('dialog button')).find((button) => button.textContent === label)!.click())
  return { container, find: inputs[0], replace: inputs[1], set, click, unmount: () => act(async () => root.unmount()) }
}
const text = () => editor!.getText()

it('counts matches, highlights them and steps through them', async () => {
  const { container, find, set, click, unmount } = await open('Dragon and dragon and DRAGON')
  await set(find, 'dragon')
  expect(container.querySelector('dialog [role="status"]')!.textContent).toBe('3 matches')
  expect(editor!.view.dom.querySelectorAll('.search-match')).toHaveLength(3)
  await click('Next')
  expect(editor!.state.doc.textBetween(editor!.state.selection.from, editor!.state.selection.to)).toBe('Dragon')
  await click('Next')
  expect(editor!.state.selection.from).toBeGreaterThan(1)
  await unmount()
})

it('replaces the current match, all matches, and respects Match case', async () => {
  const { container, find, replace, set, click, unmount } = await open('cat Cat cat')
  await set(find, 'cat')
  await set(replace, 'dog')
  await click('Replace All')
  expect(text()).toBe('dog dog dog')
  editor!.commands.setContent('cat Cat cat')
  await act(async () => container.querySelector<HTMLInputElement>('dialog input[type="checkbox"]')!.click())
  expect(container.querySelector('dialog [role="status"]')!.textContent).toBe('2 matches')
  await click('Next')
  await click('Replace')
  expect(text()).toBe('dog Cat cat')
  await unmount()
})
