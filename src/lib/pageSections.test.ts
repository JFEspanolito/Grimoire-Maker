import type { Editor } from '@tiptap/react'
import { afterEach, expect, it } from 'vitest'
import { currentPage, currentSheet } from './pageSections'

afterEach(() => { document.body.replaceChildren() })
const rect = (top: number, bottom: number) => new DOMRect(0, top, 200, bottom - top)

it('returns no page until the editor is mounted', () => {
  const editor = { get view() { throw new Error('Not mounted') } } as unknown as Editor
  expect(currentSheet(editor)).toBeNull()
  expect(currentPage(editor)).toBeNull()
})

it('selects the nearest sheet in a gap and never splits a block that spans consecutive sheets', () => {
  const stack = document.createElement('div'); stack.dataset.editorStack = ''
  const sheets = [rect(0, 100), rect(120, 220), rect(240, 340)].map((area, index) => {
    const element = document.createElement('div'); element.dataset.editorSheet = String(index + 1)
    element.getBoundingClientRect = () => area; stack.append(element); return element
  })
  const dom = document.createElement('div'); stack.append(dom); document.body.append(stack)
  const spanning = document.createElement('p'); spanning.getClientRects = () => [rect(20, 180)] as unknown as DOMRectList
  const final = document.createElement('p'); final.getClientRects = () => [rect(250, 300)] as unknown as DOMRectList
  const editor = {
    view: { dom, coordsAtPos: () => ({ left: 10, top: 110, bottom: 116 }), nodeDOM: (pos: number) => pos === 1 ? spanning : final },
    state: { selection: { from: 1 }, doc: { forEach: (section: (node: unknown, offset: number) => void) => section({ forEach: (block: (node: null, offset: number) => void) => { block(null, 0); block(null, 10) } }, 0) } },
  } as unknown as Editor
  expect(currentSheet(editor)).toEqual({ element: sheets[1], number: 2 })
  expect(currentPage(editor)).toEqual({ sheet: 2, start: 1, next: 11 })
})
