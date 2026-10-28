import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import bookmarks from '../assets/mods/Plugins/bookmarks/bookmarks'
import { describeBlock, locateBlock } from '../assets/mods/Plugins/bookmarks/anchors'
import { useBookmarks } from '../assets/mods/Plugins/bookmarks/bookmarkStore'
import type { PluginApi, PluginContextAction, PluginPanel } from '../types/plugin'
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
  const actions: PluginContextAction[] = []
  const api = { registerToolbar: (value: PluginPanel) => { toolbar.push(value) }, registerContextAction: (value: PluginContextAction) => { actions.push(value) } }
  bookmarks.activate(api as unknown as PluginApi)
  return { Button: toolbar[0].component, action: actions[0], actions }
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
  useBookmarks.setState({ root: null, items: [], error: '' })
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

const clickContext = (target: Element | null, path: string | null = '/book/Draft/Chapter 1.md') => ({ target, path, selectionText: '', x: 40, y: 50 })

it('registers one context action and no page behavior or menu of its own', async () => {
  const { actions, Button } = activate()
  expect(actions.map(action => [action.id, action.label])).toEqual([['bookmarks.add', 'Add to bookmark']])
  root = createRoot(document.body.appendChild(document.createElement('div')))
  await act(async () => root?.render(<Button />))
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
  surface.querySelectorAll('p')[0].dispatchEvent(event)
  expect(event.defaultPrevented).toBe(false)
  expect(document.querySelector('[role="menu"]')).toBeNull()
})

it('adds the clicked block as a bookmark saved relative to the project, once', () => {
  const { action } = activate()
  const first = surface.querySelectorAll('p')[0]
  expect(action.when?.(clickContext(first))).toBe(true)
  action.run(clickContext(first))
  expect(useBookmarks.getState().items).toMatchObject([{ path: 'Draft/Chapter 1.md', index: 1, excerpt: 'First paragraph' }])
  action.run(clickContext(first))
  expect(useBookmarks.getState().items).toHaveLength(1)
})

it('only applies to text blocks of Markdown pages', () => {
  const { action } = activate()
  expect(action.when?.(clickContext(surface.querySelectorAll('p')[1]))).toBe(false)
  expect(action.when?.(clickContext(surface))).toBe(false)
  expect(action.when?.(clickContext(null))).toBe(false)
  expect(action.when?.(clickContext(surface.querySelector('p'), '/book/cover.png'))).toBe(false)
  expect(action.when?.(clickContext(surface.querySelector('p'), null))).toBe(false)
  action.run(clickContext(surface.querySelector('p'), '/book/cover.png'))
  expect(useBookmarks.getState().items).toEqual([])
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
