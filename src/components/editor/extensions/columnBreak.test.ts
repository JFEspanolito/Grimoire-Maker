import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import { ColumnBreak } from './columnBreak'

let editor: Editor | null = null

function createEditor(content: string | object): Editor {
  editor = new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit, ColumnBreak, Markdown.configure({ html: true })],
    content,
  })
  return editor
}

const markdownOf = (e: Editor): string =>
  (e.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown()

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('ColumnBreak', () => {
  it('inserts and serializes as a column break HTML marker', () => {
    const e = createEditor('<p>Left column</p>')
    expect(e.commands.insertColumnBreak()).toBe(true)

    const markdown = markdownOf(e)
    expect(markdown).toContain('<div data-type="column-break"></div>')
  })

  it('round-trips through Markdown', () => {
    const source = '<p>Left column</p>\n\n<div data-type="column-break"></div>\n\n<p>Right column</p>'
    const e = createEditor(source)
    expect(e.state.doc.childCount).toBe(3)
    expect(e.state.doc.child(1).type.name).toBe('columnBreak')

    const saved = markdownOf(e)
    expect(saved).toContain('<div data-type="column-break"></div>')

    const reloaded = createEditor(saved)
    expect(reloaded.state.doc.child(1).type.name).toBe('columnBreak')
  })
})
