import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import bookmarks from '../assets/mods/Plugins/bookmarks/bookmarks'
import { describeBlock, locateBlock } from '../assets/mods/Plugins/bookmarks/anchors'
import { useBookmarks } from '../assets/mods/Plugins/bookmarks/bookmarkStore'
import type { PluginApi, PluginPageBehavior, PluginPanel } from '../types/plugin'
import { useDocumentStore } from '../stores/documentStore'
import { useTabStore } from '../stores/tabStore'

const files = vi.hoisted(() => ({ saved: '' as string | null, writes: [] as string[] }))
vi.mock('./projectData', () => ({
  readProjectData: vi.fn(async () => files.saved),
  writeProjectData: vi.fn(async (_root: string, _id: string, text: string) => { files.writes.push(text); files.saved = text }),
}))
const openFile = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('../hooks/useFileSystem', () => ({ useFileSystem: () => ({ openFile }) }))

function activate() {
  const toolbar: PluginPanel[] = []
  const behaviors: PluginPageBehavior[] = []
  const api = { registerToolbar: (value: PluginPanel) => { toolbar.push(value) }, registerPageBehavior: (value: PluginPageBehavior) => { behaviors.push(value) } }
  bookmarks.activate(api as unknown as PluginApi)
  return { Button: toolbar[0].component, behavior: behaviors[0] }
}

let root: Root | undefined
let surface: HTMLDivElement
beforeEach(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  HTMLDialogElement.prototype.showModal = vi.fn()
  HTMLDialogElement.prototype.close = vi.fn()
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.animate = vi.fn() as unknown as typeof Element.prototype.animate
  files.saved = null
  files.writes = []
  openFile.mockClear()
  useDocumentStore.setState({ workspaceRoot: '/book' })
  useTabStore.getState().reset('/book/Draft/Chapter 1.md')
  useBookmarks.setState({ root: null, items: [], error: '', menu: null })
  surface = document.createElement('div')
  surface.dataset.activeEditor = 'true'
  surface.innerHTML = '<div class="ProseMirror"><h1>Title</h1><p>First paragraph</p><p></p><p>Second paragraph</p></div>'
  document.body.append(surface)
})
afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = undefined
  surface.remove()
  vi.restoreAllMocks()
})

it('describes a text block and finds it again by its text after blocks move', () => {
  const editor = surface.querySelector('.ProseMirror')!
  const second = editor.querySelectorAll('p')[2]
  const anchor = describeBlock(second)!
  expect(anchor).toEqual({ index: 3, excerpt: 'Second paragraph' })
  expect(describeBlock(editor.querySelectorAll('p')[1])).toBeNull()
  expect(describeBlock(surface)).toBeNull()
  editor.querySelector('h1')!.remove()
  expect(locateBlock(editor, anchor)).toBe(second)
  second.textContent = 'Rewritten'
  expect(locateBlock(editor, anchor)).toBeNull()
})

it('adds a bookmark from the page right-click menu and saves it relative to the project', async () => {
  const { Button, behavior } = activate()
  const dispose = behavior.mount(surface, { kind: 'editor', zoom: 1, setZoom: () => {} })
  root = createRoot(document.body.appendChild(document.createElement('div')))
  await act(async () => root?.render(<Button />))

  const plain = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 50 })
  await act(async () => { surface.querySelector('.ProseMirror')!.dispatchEvent(plain) })
  expect(plain.defaultPrevented).toBe(false)
  expect(document.querySelector('[role="menu"]')).toBeNull()

  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 50 })
  await act(async () => { surface.querySelectorAll('p')[0].dispatchEvent(event) })
  expect(event.defaultPrevented).toBe(true)
  await act(async () => document.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click())

  expect(document.querySelector('[role="menu"]')).toBeNull()
  expect(useBookmarks.getState().items).toMatchObject([{ path: 'Draft/Chapter 1.md', index: 1, excerpt: 'First paragraph' }])
  expect(JSON.parse(files.writes.at(-1)!).items[0].path).toBe('Draft/Chapter 1.md')

  // The same block is not saved twice.
  await act(async () => { surface.querySelectorAll('p')[0].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })) })
  await act(async () => document.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click())
  expect(useBookmarks.getState().items).toHaveLength(1)
  dispose()
})

it('ignores previews and non-Markdown files', async () => {
  const { behavior } = activate()
  const preview = behavior.mount(surface, { kind: 'preview', zoom: 1, setZoom: () => {} })
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
  surface.querySelector('p')!.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(false)
  preview()
  useTabStore.getState().reset('/book/cover.png')
  const editor = behavior.mount(surface, { kind: 'editor', zoom: 1, setZoom: () => {} })
  const image = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
  surface.querySelector('p')!.dispatchEvent(image)
  expect(image.defaultPrevented).toBe(false)
  editor()
})

it('lists the project bookmarks, opens one at its text and removes another', async () => {
  files.saved = JSON.stringify({ version: 1, items: [
    { id: 'a', path: 'Draft/Chapter 1.md', index: 1, excerpt: 'First paragraph' },
    { id: 'b', path: 'Draft/Chapter 2.md', index: 0, excerpt: 'Gone text' },
  ] })
  const { Button } = activate()
  root = createRoot(document.body.appendChild(document.createElement('div')))
  await act(async () => root?.render(<Button />))
  expect(document.body.textContent).toContain('Bookmarks 2')

  await act(async () => document.querySelector<HTMLButtonElement>('button[title="Bookmarks of this project"]')!.click())
  expect(document.querySelector('dialog')!.textContent).toContain('Draft/Chapter 2')

  await act(async () => document.querySelector<HTMLButtonElement>('button[title="Go to this bookmark"]')!.click())
  expect(openFile).toHaveBeenCalledWith('/book/Draft/Chapter 1.md')
  expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
  expect(document.querySelector('dialog')).toBeNull()

  await act(async () => document.querySelector<HTMLButtonElement>('button[title="Bookmarks of this project"]')!.click())
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Remove bookmark Gone text"]')!.click())
  expect(useBookmarks.getState().items.map(item => item.id)).toEqual(['a'])
  expect(JSON.parse(files.writes.at(-1)!).items).toHaveLength(1)
})

it('keeps the list open and explains when a bookmarked text no longer exists', async () => {
  vi.useFakeTimers()
  files.saved = JSON.stringify({ version: 1, items: [{ id: 'b', path: 'Draft/Chapter 2.md', index: 0, excerpt: 'Gone text' }] })
  const { Button } = activate()
  root = createRoot(document.body.appendChild(document.createElement('div')))
  await act(async () => root?.render(<Button />))
  await act(async () => document.querySelector<HTMLButtonElement>('button[title="Bookmarks of this project"]')!.click())
  const go = act(async () => {
    document.querySelector<HTMLButtonElement>('button[title="Go to this bookmark"]')!.click()
    await vi.advanceTimersByTimeAsync(3000)
  })
  await go
  vi.useRealTimers()
  expect(document.querySelector('dialog [role="alert"]')?.textContent).toContain('no longer in Draft/Chapter 2')
})
