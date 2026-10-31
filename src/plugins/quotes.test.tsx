import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import quotes from '../assets/mods/Plugins/quotes/quotes'
import { useQuotes } from '../assets/mods/Plugins/quotes/quotesStore'
import { ensureReferenceForQuote, syncReferences, insertQuote, syncReferenceItem, handleInsertReferenceCitation } from '../assets/mods/Plugins/quotes/referencesManager'
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
    exists: vi.fn(async (p: string) => fsMock.files.has(p.replaceAll('\\', '/'))),
    readTextFile: vi.fn(async (p: string) => fsMock.files.get(p.replaceAll('\\', '/')) ?? ''),
    writeTextFile: vi.fn(async (p: string, content: string) => { fsMock.files.set(p.replaceAll('\\', '/'), content) }),
    readDir: vi.fn(async (dir: string) => {
      const normalizedDir = dir.replaceAll('\\', '/').replace(/\/+$/, '')
      const entries = new Map<string, { name: string; isDirectory: boolean }>()
      for (const p of fsMock.files.keys()) {
        const norm = p.replaceAll('\\', '/').replace(/\/+$/, '')
        if (norm.startsWith(`${normalizedDir}/`)) {
          const rest = norm.slice(normalizedDir.length + 1)
          const parts = rest.split('/')
          const name = parts[0]
          const isDirectory = parts.length > 1
          if (!entries.has(name) || isDirectory) {
            entries.set(name, { name, isDirectory })
          }
        }
      }
      return Array.from(entries.values())
    }),
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
  HTMLDialogElement.prototype.show = vi.fn(function (this: HTMLDialogElement) { this.open = true })
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) { this.open = false })
  files.saved = null
  files.writes = []
  fsMock.files.clear()
  useDocumentStore.setState({ workspaceRoot: '/book' })
  useTabStore.getState().reset('/book/Draft/Chapter 1.md')
  useQuotes.setState({ root: null, items: [], references: [], error: '' })
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

it('adds selected text as a quote with metadata and does not contaminate author with filename', () => {
  const { action } = activate()
  action.run({ target: null, selectionText: 'All models are wrong, but some are useful.', path: '/book/Research/References.md', x: 0, y: 0 })
  const quotesList = useQuotes.getState().items
  expect(quotesList).toHaveLength(1)
  expect(quotesList[0].quoteText).toBe('All models are wrong, but some are useful.')
  expect(quotesList[0].authorLastName).toBe('')
  expect(quotesList[0].authorLastName).not.toBe('References')
})

it('creates References.md and formats APA bibliography without numeric prefix', async () => {
  const quote = useQuotes.getState().add({
    quoteText: 'Information wants to be free.',
    authorLastName: 'Brand',
    authorInitial: 'S.',
    year: '1984',
    title: 'Whole Earth Review',
    page: '49',
    quoteType: 'APA',
  })!

  const result = await ensureReferenceForQuote('/book', quote)
  expect(result.quoteMarkdown).toBe('"Information wants to be free." (Brand, 1984, p. 49).')
  expect(result.quoteMarkdown).not.toContain('—')
  expect(result.quoteMarkdown).not.toContain('[1]')
  expect(fsMock.files.has('/book/Draft/References.md')).toBe(true)
  expect(fsMock.files.get('/book/Draft/References.md')).toContain('Brand, S. (1984). *Whole Earth Review*.')
})

it('formats IEEE references with sequential numeric brackets', async () => {
  const quote = useQuotes.getState().add({
    quoteText: 'Second quote',
    authorLastName: 'Turing',
    authorInitial: 'A.',
    year: '1950',
    title: 'Computing Machinery',
    page: '433',
    quoteType: 'IEEE',
  })!

  const result = await ensureReferenceForQuote('/book', quote)
  expect(result.referenceNumber).toBe(1)
  expect(result.quoteMarkdown).toBe('"Second quote" [1, p. 433].')
  const content = fsMock.files.get('/book/Draft/References.md')!
  expect(content).toContain('[1] A. Turing, *Computing Machinery*. 1950, p. 433.')
})

it('renders QuotesButton and opens quotes modal with new quote button and dropdown', async () => {
  files.saved = JSON.stringify({
    version: 2,
    items: [{
      id: 'q1',
      quoteText: 'Simple quote',
      sourcePath: 'Draft/test.md',
      authorLastName: 'Smith',
      year: '2023',
      page: '10',
      title: 'Test',
      quoteType: 'APA',
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

  const select = document.querySelector<HTMLSelectElement>('select')
  expect(select).not.toBeNull()
  expect(Array.from(select?.options ?? []).map(o => o.value)).toEqual(['APA', 'IEEE', 'MLA', 'Chicago', 'Harvard'])

  const newBtn = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(b => b.textContent?.includes('+ New quote'))
  expect(newBtn).toBeDefined()
  await act(async () => newBtn?.click())
  expect(useQuotes.getState().items).toHaveLength(2)

  const textareas = document.querySelectorAll<HTMLTextAreaElement>('textarea')
  expect(textareas.length).toBeGreaterThanOrEqual(1)

  const tabs = document.querySelectorAll<HTMLButtonElement>('[role="tab"]')
  expect(tabs).toHaveLength(2)
  expect(tabs[0].textContent).toContain('Quotes')
  expect(tabs[1].textContent).toContain('References')

  await act(async () => tabs[1].click())
  expect(document.querySelector('dialog')?.textContent).toContain('No references added yet')
  expect(document.querySelector('dialog')?.textContent).toContain('+ New reference')

  const newRefBtn = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(b => b.textContent?.includes('+ New reference'))
  expect(newRefBtn).toBeDefined()
  await act(async () => newRefBtn?.click())
  expect(useQuotes.getState().references).toHaveLength(1)
  expect(document.querySelector('dialog')?.textContent).toContain('[2]')

  // In edit mode, Insert citation button is disabled
  const insertBtn = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(b => b.textContent?.includes('Insert citation at cursor'))
  expect(insertBtn).toBeDefined()
  expect(insertBtn?.disabled).toBe(true)

  // Toggle edit off after setting content
  act(() => {
    useQuotes.getState().updateReference(useQuotes.getState().references[0].id, {
      authors: 'Smith, J.',
      title: 'Valid Title',
    })
  })
  const toggleBtn = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(b => b.textContent?.includes('Done editing'))
  expect(toggleBtn).toBeDefined()
  await act(async () => toggleBtn?.click())
  expect(insertBtn?.disabled).toBe(false)

  await act(async () => tabs[0].click())
  expect(document.querySelector('dialog')?.textContent).toContain('Simple quote')
})

it('finds and appends references to nested References.md in template subfolders', async () => {
  const nestedRefPath = '/book/Draft/thesis-example/chapters/Appendices/References.md'
  fsMock.files.set(nestedRefPath, '# References\n\n')

  const quote = useQuotes.getState().add({
    quoteText: 'A profound thesis statement.',
    sourcePath: 'Draft/thesis-example/chapters/00 - Front Matter/Abstract and Keywords.md',
    authorLastName: 'Espanolito',
    authorInitial: 'J.',
    year: '2026',
    title: 'Grimoire Architecture',
    page: '12',
    quoteType: 'APA',
  })!

  const result = await ensureReferenceForQuote('/book', quote)
  expect(fsMock.files.has(nestedRefPath)).toBe(true)
  expect(fsMock.files.get(nestedRefPath)).toContain('Espanolito, J. (2026). *Grimoire Architecture*.')
  expect(fsMock.files.has('/book/Draft/References.md')).toBe(false)
})

it('syncs indirect references to References.md for both IEEE and APA styles', async () => {
  // Test APA indirect reference
  const apaRef = useQuotes.getState().addReference({
    authors: 'Fraústo da Silva, J. J. R.',
    year: '1991',
    title: 'The biological chemistry of the elements',
    sourceContainer: 'Oxford University Press',
    style: 'APA',
  })!

  const apaSync = await syncReferenceItem('/book', apaRef)
  expect(apaSync.targetPath).toBe('/book/Draft/References.md')
  const contentAfterApa = fsMock.files.get('/book/Draft/References.md')!
  expect(contentAfterApa).toContain('Fraústo da Silva, J. J. R. (1991). *The biological chemistry of the elements*. Oxford University Press.')

  // Test IEEE indirect reference
  const ieeeRef = useQuotes.getState().addReference({
    authors: 'Shannon, C. E.',
    year: '1948',
    title: 'A Mathematical Theory of Communication',
    sourceContainer: 'Bell System Technical Journal',
    volumeIssuePages: 'vol. 27, no. 3, pp. 379-423',
    style: 'IEEE',
  })!

  const ieeeSync = await syncReferenceItem('/book', ieeeRef)
  expect(ieeeSync.refIndex).toBe(2)
  const contentAfterIeee = fsMock.files.get('/book/Draft/References.md')!
  expect(contentAfterIeee).toContain('[2] Shannon, C. E., *A Mathematical Theory of Communication*, Bell System Technical Journal, vol. 27, no. 3, pp. 379-423, 1948.')
})

it('correctly handles citation insertion when no draft editor is active', () => {
  const ref = useQuotes.getState().addReference({
    authors: 'Fraústo da Silva, J. J. R.',
    year: '1991',
    title: 'The biological chemistry of the elements',
    sourceContainer: 'Oxford University Press',
    style: 'APA',
  })!

  const result = handleInsertReferenceCitation(ref, 'APA')
  expect(result.success).toBe(false)
  expect(result.message).toContain('Open a Draft document')
})

it('shares sequential numbering between Quotes and References', () => {
  const quote1 = useQuotes.getState().add({
    quoteText: 'First quote text',
    authorLastName: 'AuthorOne',
    year: '2020',
    title: 'Paper 1',
    quoteType: 'IEEE',
  })!
  expect(quote1.refIndex).toBe(1)

  const ref2 = useQuotes.getState().addReference({
    authors: 'AuthorTwo',
    year: '2021',
    title: 'Paper 2',
    style: 'IEEE',
  })!
  expect(ref2.refIndex).toBe(2)

  const quote3 = useQuotes.getState().add({
    quoteText: 'Third quote text',
    authorLastName: 'AuthorThree',
    year: '2022',
    title: 'Paper 3',
    quoteType: 'IEEE',
  })!
  expect(quote3.refIndex).toBe(3)

  const ref4 = useQuotes.getState().addReference({
    authors: 'AuthorFour',
    year: '2023',
    title: 'Paper 4',
    style: 'IEEE',
  })!
  expect(ref4.refIndex).toBe(4)
})

it('does not duplicate entries when updating a reference with syncReferenceItem', async () => {
  const ref = useQuotes.getState().addReference({
    authors: 'Smith, J.',
    year: '2026',
    title: 'Initial Title',
    style: 'APA',
  })!

  await syncReferenceItem('/book', ref)
  let content = fsMock.files.get('/book/Draft/References.md')!
  expect(content).toContain('Smith, J. (2026). *Initial Title*.')

  // Update title on the same reference
  const updatedRef = { ...ref, title: 'Updated Title' }
  useQuotes.getState().updateReference(ref.id, { title: 'Updated Title' })
  await syncReferenceItem('/book', updatedRef)

  content = fsMock.files.get('/book/Draft/References.md')!
  expect(content).toContain('Smith, J. (2026). *Updated Title*.')
  expect(content).not.toContain('Smith, J. (2026). *Initial Title*.')
  // Ensure the entry appears exactly once
  const matches = content.match(/Smith, J\. \(2026\)/g)
  expect(matches).toHaveLength(1)
})

it('appends at the bottom with sequential dot numbering when document uses numbered references', async () => {
  const initialContent = '# References\n\n- **Guideline**: Mentions Elena and 2026 in description.\n\n---\n\n1. First (2024). *One*.\n\n2. Second (2025). *Two*.\n'
  fsMock.files.set('/book/Draft/References.md', initialContent)

  const ref = useQuotes.getState().addReference({
    authors: 'Elena',
    year: '2026',
    title: 'Acerca de ser Puntual',
    sourceContainer: 'puntualidad.org',
    style: 'APA',
  })!

  await syncReferenceItem('/book', ref)
  const content = fsMock.files.get('/book/Draft/References.md')!

  // Must not replace the guideline
  expect(content).toContain('- **Guideline**: Mentions Elena and 2026 in description.')
  // Must append at the bottom with bracket number [3]
  expect(content).toContain('[3] Elena (2026). *Acerca de ser Puntual*. puntualidad.org.')
  // Guideline line must come before the new entry
  expect(content.indexOf('- **Guideline**')).toBeLessThan(content.indexOf('[3] Elena'))
})
