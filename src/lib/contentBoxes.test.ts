import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import { ContentBox } from '../components/editor/extensions/ContentBox'
import { GrimoireImage } from '../components/editor/extensions/image'
import { CharacterSheet, ReadAloud, Statblock } from '../components/editor/extensions/blocks'
import { TableExtensions } from '../components/editor/extensions/tables'
import { SNIPPETS } from '../components/snippets/snippets'
import { insertContentBox, moveContentBox } from './contentBoxes'

const editors: Editor[] = []
function create(content = '') {
  const editor = new Editor({ extensions: [StarterKit, ContentBox, GrimoireImage,
    ...TableExtensions, CharacterSheet, ReadAloud, Statblock, Markdown.configure({ html: true })], content,
    editorProps: { handleScrollToSelection: () => true } })
  editors.push(editor)
  return editor
}
const markdown = (editor: Editor): string => (editor.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown()
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()))

describe('standard content boxes', () => {
  it.each(SNIPPETS)('wraps every node of $id in one editable box', (snippet) => {
    const editor = create()
    expect(insertContentBox(editor, snippet.node)).toBe(true)
    expect(editor.state.doc.firstChild?.type.name).toBe('standardContentBox')
    expect(editor.state.doc.firstChild?.childCount).toBe(Array.isArray(snippet.node) ? snippet.node.length : 1)
    expect(create(markdown(editor)).state.doc.firstChild?.toJSON()).toEqual(editor.state.doc.firstChild?.toJSON())
    expect(editor.commands.undo()).toBe(true)
    expect(editor.state.doc.textContent).toBe('')
    expect(editor.commands.redo()).toBe(true)
    expect(editor.state.doc.firstChild?.type.name).toBe('standardContentBox')
  })
  it('leaves old content and ordinary insertion unchanged, wraps new Markdown only', () => {
    const editor = create('Old text')
    editor.commands.insertContentAt(editor.state.doc.content.size, '<p>Ordinary</p>')
    insertContentBox(editor, '## New <unknown>literal</unknown>\n\nBody', editor.state.doc.content.size)
    expect(editor.state.doc.child(0).type.name).toBe('paragraph')
    expect(editor.state.doc.child(1).type.name).toBe('paragraph')
    expect(editor.state.doc.child(2).type.name).toBe('standardContentBox')
    expect(editor.state.doc.textContent).toContain('New literalBody')
  })
  it('round-trips free placement, tables, nested images and literal text safely', () => {
    const editor = create()
    insertContentBox(editor, 'Text & <tag>retained</tag>\n\n![Map](assets/map.png)')
    editor.commands.setNodeSelection(0)
    editor.commands.updateAttributes('standardContentBox', { placement: 'free', widthMm: 72, heightMm: 80, xMm: 15, yMm: 22 })
    expect(markdown(editor)).toContain('data-height-mm="80"')
    const reloaded = create(markdown(editor))
    expect(reloaded.state.doc.firstChild?.toJSON()).toEqual(editor.state.doc.firstChild?.toJSON())
    expect(markdown(editor)).not.toContain('contenteditable')
    expect(markdown(editor)).not.toContain('Move content box')
  })
  it('moves the whole flow box in document order in one undoable gesture', () => {
    const editor = create('Before\n\nAfter')
    insertContentBox(editor, '## Group\n\nTogether', 8)
    const before = editor.getJSON()
    const position = editor.state.doc.child(0).nodeSize
    expect(moveContentBox(editor, position, editor.state.doc.content.size)).toBe(true)
    expect(editor.state.doc.child(2).type.name).toBe('standardContentBox')
    expect(editor.state.doc.child(2).attrs.placement).toBe('flow')
    editor.commands.undo()
    expect(editor.getJSON()).toEqual(before)
  })
  it('sanitizes unsafe layout attributes while retaining their child text', () => {
    const editor = create('<div data-type="standard-content-box" data-placement="evil" data-width-mm="NaN" data-x-mm="-2" data-y-mm="Infinity"><p>Keep me</p></div>')
    expect(editor.state.doc.firstChild?.attrs).toMatchObject({ placement: 'flow', widthMm: null, xMm: 0, yMm: null })
    expect(editor.state.doc.textContent).toBe('Keep me')
  })
  it('undoes insertion without undoing immediately preceding ordinary typing', () => {
    const editor = create('Old text')
    editor.commands.insertContentAt(2, 'typing')
    const before = editor.getJSON()
    insertContentBox(editor, '## Group', editor.state.doc.content.size)
    editor.commands.undo()
    expect(editor.getJSON()).toEqual(before)
  })
  it('inserts sibling groups when a plugin or drop targets the inside of an existing box', () => {
    const editor = create()
    insertContentBox(editor, 'First group')
    editor.commands.setTextSelection(3)
    insertContentBox(editor, 'Second group')
    expect(editor.state.doc.child(0).textContent).toBe('First group')
    expect(editor.state.doc.child(1).textContent).toBe('Second group')
    expect(editor.state.doc.child(0).firstChild?.type.name).toBe('paragraph')
    insertContentBox(editor, 'Dropped group', 3)
    expect(editor.state.doc.child(1).textContent).toBe('Dropped group')
    expect(editor.state.doc.child(2).textContent).toBe('Second group')
  })
})
