import { expect, it } from 'vitest'
import { pageColumns, pageTitle, projectPageText } from './pageProperties'

it('uses saved book metadata independently of folder names', () => {
  const project = { name: 'Old separate name', author: 'Alice', coAuthor: 'Bob' }
  expect(projectPageText('H:/books/My Grimoire', { title: 'Chapter' }, project)).toEqual({
    book: 'Old separate name', title: 'Chapter', author: 'Alice', coAuthor: 'Bob',
  })
  expect(projectPageText('H:/books/Renamed', {}, project).book).toBe('Old separate name')
})
it('titles a saved page by its file name and an unsaved page by its frontmatter', () => {
  expect(pageTitle({ title: 'Old' }, '/w/Draft/Chapter 1/The Crypt.md')).toBe('The Crypt')
  expect(pageTitle({ title: 'Old' }, 'C:\\w\\Draft\\Scene.md')).toBe('Scene')
  expect(pageTitle({ title: 'Draft title' }, null)).toBe('Draft title')
  expect(projectPageText('/w', { title: 'Old' }, undefined, '/w/Draft/Scene.md').title).toBe('Scene')
})
it('preserves page-column overrides and their fallback', () => {
  expect(pageColumns({ columns: 1 }, 2)).toBe(1)
  expect(pageColumns({}, 2)).toBe(2)
})

it('uses all co-author names from the list while preserving legacy fallback', () => {
  const project = { name: 'Book', author: 'Alice', coAuthor: 'Legacy' }
  expect(projectPageText('/book', {}, project).coAuthor).toBe('Legacy')
  expect(projectPageText('/book', {}, { ...project, coAuthors: [
    { name: 'One', socialMedia: '@one', platform: 'Instagram' },
    { name: 'Two', socialMedia: '', platform: '' },
  ] }).coAuthor).toBe('One, Two')
  expect(projectPageText('/book', {}, { ...project, coAuthors: [] }).coAuthor).toBe('')
})
