import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import quotes, { addToQuote } from '../assets/mods/Plugins/quotes/quotes'
import { useQuotes } from '../assets/mods/Plugins/quotes/quotesStore'
import { ensureReferenceForQuote } from '../assets/mods/Plugins/quotes/referencesManager'
import type { PluginApi, PluginContextAction, PluginPanel } from '../types/plugin'
import { useDocumentStore } from '../stores/documentStore'
import { useTabStore } from '../stores/tabStore'

const files = vi.hoisted(() => ({ saved: '' as string | null, writes: [] as string[] }))
const fsMock = vi.hoisted(() => ({
  files: new Map<string, string>(),
}))

vi.mock('./projectData', () => ({
  readProjectData: vi.fn(async () => files.saved),
  writeProjectData: vi.fn(async (_root: string, _id: string, text: string) => { files.writes.push(text); files.saved = text }),
}))

vi.mock('@tauri-apps/plugin-fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tauri-apps/plugin-fs')>()
  return {
    ...actual,
    exists: vi.fn(async (p: string) => fsMock.files.has(p)),
    readTextFile: vi.fn(async (p: string) => fsMock.files.get(p) ?? ''),
    writeTextFile: vi.fn(async (p: string, content: string) => { fsMock.files.set(p, content) }),
  }
})

function activate() {
  const toolbar: PluginPanel[] = []
  const actions: PluginContextAction[] = []
  const api = {
    registerToolbar: (value: PluginPanel) => { toolbar.push(value) },
    registerContextAction: (value: PluginContextAction) => { actions.push(value) },
  }
  quotes.activate(api as unknown as PluginApi)
  return { Button: toolbar[0].component, action: actions[0], actions }
}

let root: Root | undefined
beforeEach(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  HTMLDialogElement.prototype.showModal = vi.fn()
  HTMLDialogElement.prototype.close = vi.fn()
  files.saved = null
  files.writes = []
  fsMock.files.clear()
  useDocumentStore.setState({ workspaceRoot: '/book' })
  useTabStore.getState().reset('/book/Draft/Chapter 1.md')
  useQuotes.setState({ root: null, items: [], error: '' })
})

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = undefined
  vi.restoreAllMocks()
})

it('registers quotes toolbar control and context action', () => {
  const { actions, Button } = activate()
  expect(Button).toBeDefined()
  expect(actions.map((a) => [a.id, a.label])).toEqual([['quotes.add', 'Add to quote']])
})

it('only activates Add to quote when text is selected', () => {
  const { action } = activate()
  expect(action.when?.({ target: null, selectionText: 'Some meaningful citation', path: '/book/Research/doc.pdf', x: 0, y: 0 })).toBe(true)
  expect(action.when?.({ target: null, selectionText: '   ', path: '/book/Draft/note.md', x: 0, y: 0 })).toBe(false)
  expect(action.when?.({ target: null, selectionText: '', path: null, x: 0, y: 0 })).toBe(false)
})

it('adds selected text as a quote with metadata', () => {
  const { action } = activate()
  action.run({ target: null, selectionText: 'All models are wrong, but some are useful.', path: '/book/Research/Box_1976.pdf', x: 0, y: 0 })
  const quotesList = useQuotes.getState().items
  expect(quotesList).toHaveLength(1)
  expect(quotesList[0]).toMatchObject({
    text: 'All models are wrong, but some are useful.',
    sourcePath: 'Research/Box_1976.pdf',
    author: 'Box',
    year: '1976',
  })
})

it('creates References.md if it does not exist and assigns reference 1', async () => {
  const quote = useQuotes.getState().add({
    text: 'Information wants to be free.',
    author: 'Brand, S.',
    year: '1984',
    title: 'Whole Earth Review',
    page: '49',
  })!

  const result = await ensureReferenceForQuote('/book', quote)
  expect(result.referenceNumber).toBe(1)
  expect(result.quoteMarkdown).toContain('[[1]]')
  expect(fsMock.files.has('/book/Draft/References.md')).toBe(true)
  expect(fsMock.files.get('/book/Draft/References.md')).toContain('1. Brand, S. (1984). *Whole Earth Review*, p. 49.')
})

it('appends sequential references to existing References.md', async () => {
  fsMock.files.set('/book/Draft/References.md', '---\ntitle: References\n---\n# References\n\n1. Existing Author (2020). *Existing Work*.\n')

  const quote = useQuotes.getState().add({
    text: 'Second quote',
    author: 'Turing, A.',
    year: '1950',
    title: 'Computing Machinery',
    page: '433',
  })!

  const result = await ensureReferenceForQuote('/book', quote)
  expect(result.referenceNumber).toBe(2)
  expect(result.quoteMarkdown).toContain('[[2]]')
  const content = fsMock.files.get('/book/Draft/References.md')!
  expect(content).toContain('1. Existing Author')
  expect(content).toContain('2. Turing, A. (1950). *Computing Machinery*, p. 433.')
})

it('renders QuotesButton and opens quotes modal', async () => {
  files.saved = JSON.stringify({
    version: 1,
    items: [{
      id: 'q1',
      text: 'Simple quote',
      sourcePath: 'Draft/test.md',
      author: 'Author A',
      year: '2023',
      page: '10',
      title: 'Test',
      createdAt: Date.now(),
    }],
  })

  const { Button } = activate()
  const host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  await act(async () => root?.render(<Button />))

  const button = host.querySelector<HTMLButtonElement>('button')
  expect(button?.textContent).toContain('Quotes 1')

  await act(async () => button?.click())
  expect(document.querySelector('dialog')).not.toBeNull()
  expect(document.querySelector('dialog')?.textContent).toContain('Simple quote')
})
