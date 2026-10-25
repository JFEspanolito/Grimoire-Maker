import { afterEach, expect, it } from 'vitest'
import { Editor } from '@tiptap/react'
import { EDITOR_EXTENSIONS } from '../editorExtensions'
import { sectionPosition } from './section'

let editor: Editor | null = null
afterEach(() => { editor?.destroy(); editor = null })
const create = (content: string) => (editor = new Editor({ extensions: EDITOR_EXTENSIONS, content }))
const markdown = (value: Editor) => (value.storage as unknown as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown()
const sections = (value: Editor) => value.state.doc.content.content.map((node) => ({ columns: node.attrs.columns, text: node.textContent }))

it('treats a file without breaks as one section and saves it as plain Markdown', () => {
  create('# Title\n\nBody')
  expect(sections(editor!)).toEqual([{ columns: null, text: 'TitleBody' }])
  expect(markdown(editor!)).toBe('# Title\n\nBody')
})

it('splits at the cursor into a new section that keeps the text order', () => {
  create('First\n\nSecond')
  editor!.commands.setTextSelection(editor!.state.doc.firstChild!.firstChild!.nodeSize + 2)
  expect(editor!.commands.insertSectionBreak()).toBe(true)
  expect(sections(editor!).map((section) => section.text)).toEqual(['First', 'Second'])
  expect(sectionPosition(editor!.state.doc, editor!.state.selection.from)).toMatchObject({ index: 2, count: 2 })
})

it('keeps sections and their columns through saving and reopening', () => {
  create('Intro\n\nMore')
  editor!.commands.setTextSelection(editor!.state.doc.firstChild!.firstChild!.nodeSize + 2)
  editor!.commands.insertSectionBreak()
  editor!.commands.setSectionColumns(1)
  const saved = markdown(editor!)
  expect(saved).toContain('<div data-type="section-break" data-columns="1"></div>')
  expect(saved.startsWith('Intro')).toBe(true)
  const reopened = create(saved)
  expect(sections(reopened)).toEqual([{ columns: null, text: 'Intro' }, { columns: 1, text: 'More' }])
  expect(markdown(reopened)).toBe(saved)
})

it('remembers columns on a first section and merges a section back into the previous one', () => {
  create('<div data-type="section-break" data-columns="2"></div>\n\nOnly')
  expect(sections(editor!)).toEqual([{ columns: 2, text: 'Only' }])
  expect(markdown(editor!).startsWith('<div data-type="section-break" data-columns="2"></div>')).toBe(true)
  create('One\n\n<div data-type="section-break"></div>\n\nTwo')
  expect(sections(editor!).map((section) => section.text)).toEqual(['One', 'Two'])
  editor!.commands.setTextSelection(editor!.state.doc.content.size - 2)
  expect(editor!.commands.mergeSectionWithPrevious()).toBe(true)
  expect(sections(editor!)).toHaveLength(1)
  expect(editor!.commands.mergeSectionWithPrevious()).toBe(false)
})
