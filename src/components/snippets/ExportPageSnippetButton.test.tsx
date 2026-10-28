import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { ExportPageSnippetButton } from './ExportPageSnippetButton'
import { useDocumentStore } from '../../stores/documentStore'
import { useTabStore } from '../../stores/tabStore'
import { useModStore } from '../../stores/modStore'
import { useToastStore } from '../../stores/toastStore'

const mocks = vi.hoisted(() => ({ save: vi.fn() }))
vi.mock('../../lib/snippetLibrary', () => ({ saveSnippetToLibrary: mocks.save }))

let root: Root
let container: HTMLDivElement
const reload = vi.fn(async () => {})
beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  HTMLDialogElement.prototype.showModal = function () { this.open = true }
  HTMLDialogElement.prototype.close = function () { this.open = false }
})
beforeEach(async () => {
  mocks.save.mockResolvedValue({ path: '/mods/Snippets/Pages/Chapter.md' })
  useModStore.setState({ reload, snippets: [{ id: 'a/b', label: 'B', group: 'Pages', markdown: 'x' }] })
  useDocumentStore.getState().loadFromRaw('/book/Draft/chapter.md', '# Chapter\n\nHello **world**.')
  useTabStore.getState().reset('/book/Draft/chapter.md')
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(<ExportPageSnippetButton />))
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.clearAllMocks()
  useToastStore.setState({ toasts: [] })
})

const button = (label: string) => Array.from(document.querySelectorAll('button')).find((item) => item.textContent === label) as HTMLButtonElement
const setValue = async (input: HTMLInputElement, value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
})

it('saves the whole page body as a snippet with a name and a suggested category', async () => {
  await act(async () => button('Export Page Content as Snippet').click())
  const dialog = document.querySelector('dialog')!
  expect(dialog.open).toBe(true)
  expect(Array.from(dialog.querySelectorAll('datalist option')).map((option) => (option as HTMLOptionElement).value)).toEqual(['Pages'])

  await act(async () => button('Save to Snippets').click())
  expect(dialog.querySelector('[role="alert"]')?.textContent).toBe('Enter a snippet name.')
  expect(mocks.save).not.toHaveBeenCalled()

  const [name, category] = Array.from(dialog.querySelectorAll('input'))
  await setValue(name, 'Chapter opener')
  await setValue(category, 'Pages')
  await act(async () => button('Save to Snippets').click())
  expect(mocks.save).toHaveBeenCalledExactlyOnceWith({ name: 'Chapter opener', category: 'Pages', markdown: '# Chapter\n\nHello **world**.' })
  expect(reload).toHaveBeenCalledOnce()
  expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual(['Snippet añadido a la paleta lateral'])
  expect(document.querySelector('dialog')).toBeNull()
})

it('keeps the dialog open with a plain sentence when saving fails', async () => {
  mocks.save.mockRejectedValueOnce(new Error('A snippet with this name already exists.'))
  await act(async () => button('Export Page Content as Snippet').click())
  await setValue(document.querySelector('dialog input')!, 'Chapter opener')
  await act(async () => button('Save to Snippets').click())
  expect(document.querySelector('dialog [role="alert"]')?.textContent).toBe('A snippet with this name already exists.')
  expect(reload).not.toHaveBeenCalled()
  expect(useToastStore.getState().toasts).toEqual([])
  await act(async () => button('Cancel').click())
  expect(document.querySelector('dialog')).toBeNull()
})

it('is disabled for an empty page', async () => {
  await act(async () => useDocumentStore.getState().loadFromRaw('/book/Draft/empty.md', ''))
  expect(button('Export Page Content as Snippet').disabled).toBe(true)
})
