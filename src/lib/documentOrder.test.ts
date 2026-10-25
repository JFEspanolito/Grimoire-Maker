import { expect, it } from 'vitest'
import type { FileNode } from '../types/document'
import { draftDocuments, includedDocuments, moveItem, resolveDocumentOrder, toDocumentOrder } from './documentOrder'

const file = (path: string): FileNode => ({ name: path.split('/').pop()!, path, isDirectory: false })
const folder = (path: string, children: FileNode[]): FileNode => ({ name: path.split('/').pop()!, path, isDirectory: true, children })

it('defaults to the Draft documents in explorer order, excluding Trash, Research and non-Markdown files', () => {
  const tree = [
    folder('/w/Draft', [
      folder('/w/Draft/Chapter 1', [file('/w/Draft/Chapter 1/Welcome.md'), file('/w/Draft/Chapter 1/map.png')]),
      folder('/w/Draft/Chapter 2', [file('/w/Draft/Chapter 2/Bye.md')]),
      file('/w/Draft/Intro.md'),
    ]),
    folder('/w/Research', [file('/w/Research/Notes.md')]),
    folder('/w/Trash', [file('/w/Trash/Old.md')]),
  ]
  expect(draftDocuments(tree, '/w')).toEqual(['Draft/Chapter 1/Welcome.md', 'Draft/Chapter 2/Bye.md', 'Draft/Intro.md'])
  expect(draftDocuments([file('/w/a.md')], '/w')).toEqual([])
})

it('keeps the saved order and exclusions, drops deleted files and appends new ones as included', () => {
  const items = resolveDocumentOrder(['a.md', 'b.md', 'c.md', 'new.md'], { order: ['c.md', 'gone.md', 'a.md', 'b.md'], excluded: ['a.md', 'gone.md'] })
  expect(items).toEqual([
    { path: 'c.md', included: true }, { path: 'a.md', included: false }, { path: 'b.md', included: true }, { path: 'new.md', included: true },
  ])
  expect(includedDocuments(items)).toEqual(['c.md', 'b.md', 'new.md'])
  expect(resolveDocumentOrder(['a.md', 'b.md']).every((item) => item.included)).toBe(true)
})

it('round-trips a choice and moves items without leaving the list', () => {
  const items = resolveDocumentOrder(['a.md', 'b.md', 'c.md'])
  const moved = moveItem(items, 2, -1)
  expect(moved.map((item) => item.path)).toEqual(['a.md', 'c.md', 'b.md'])
  expect(moveItem(items, 0, -1)).toBe(items)
  expect(moveItem(items, 2, 1)).toBe(items)
  expect(toDocumentOrder([{ path: 'x.md', included: false }, { path: 'y.md', included: true }])).toEqual({ order: ['x.md', 'y.md'], excluded: ['x.md'] })
})
