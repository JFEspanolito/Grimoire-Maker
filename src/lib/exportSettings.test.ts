import { beforeEach, expect, it, vi } from 'vitest'
import { defaultPdfName, pageRequest, planBook } from './exportSettings'
import { useDocumentStore } from '../stores/documentStore'
import { useProjectStore } from '../stores/projectStore'

vi.mock('../stores/settingsStore', () => ({ useSettingsStore: { getState: () => ({ pageSize: 'a4', columns: 2, theme: 'custom', bleedMm: 3, marginMm: 15, showPrintMarks: true }) } }))
vi.mock('../stores/themeStore', () => ({ useThemeStore: { getState: () => ({ themes: [{ id: 'custom', headerFooter: { header: 'Book header' } }] }) } }))
beforeEach(() => { useDocumentStore.getState().resetDocuments(); useDocumentStore.getState().setWorkspace(null, []); useProjectStore.setState({ entries: {} }) })

it('plans only Draft markdown in saved reading order, omits exclusions and appends new chapters', () => {
  expect(planBook()).toBeNull()
  const children = ['a.md', 'b.md', 'new.md', 'map.png'].map(name => ({ name, path: `/book/Draft/${name}`, isDirectory: false }))
  useDocumentStore.getState().setWorkspace('/book', [{ name: 'Draft', path: '/book/Draft', isDirectory: true, children }])
  useProjectStore.setState({ entries: { '/book': { ready: true, busy: false, error: '', settings: { name: 'My book', author: '', coAuthor: '', documentOrder: { order: ['Draft/b.md', 'Draft/deleted.md', 'Draft/a.md'], excluded: ['Draft/a.md'] } } } } })
  const book = planBook()
  expect(book).toEqual({ root: '/book', documents: ['Draft/b.md', 'Draft/new.md'] })
  expect(defaultPdfName(book!)).toBe('My book')
})

it('uses page column overrides for a single page and project defaults for a book', () => {
  useDocumentStore.getState().loadFromRaw('/book/Draft/Chapter.md', '---\ntitle: Ignored filename override\ncolumns: 3\n---\n# Text')
  const page = pageRequest()
  expect(page).toMatchObject({ pageSize: 'a4', columns: 3, theme: 'custom', bleedMm: 3, marginMm: 15, showPrintMarks: true, pageText: { title: 'Chapter' } })
  expect(defaultPdfName()).toBe('Chapter')
  expect(pageRequest({ root: '/book', documents: ['Draft/Opening.md'] })).toMatchObject({ columns: 2, pageText: { title: 'Opening' } })
})
