import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import { Statblock } from './blocks'
import { TableExtensions, buildTable } from './tables'

let editor: Editor | null = null

function createEditor(content: string | object): Editor {
  editor = new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit, ...TableExtensions, Statblock, Markdown.configure({ html: true })],
    content,
  })
  return editor
}

const markdownOf = (e: Editor): string =>
  (e.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown()

function countOf(e: Editor, type: string): number {
  let count = 0
  e.state.doc.descendants((node) => {
    if (node.type.name === type) count++
  })
  return count
}

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('tables in Markdown', () => {
  it('round-trips a plain GFM table', () => {
    const source = '| d6 | Encounter |\n| --- | --- |\n| 1 | Wolves |\n| 2 | Bandits |'
    const e = createEditor(source)
    expect(countOf(e, 'tableRow')).toBe(3)
    expect(countOf(e, 'tableHeader')).toBe(2)
    const saved = markdownOf(e)
    expect(saved.trimEnd()).toBe(source)
    // Saving again must not keep adding blank lines.
    expect(markdownOf(createEditor(saved))).toBe(saved)
  })

  it('keeps a table inside a custom block', () => {
    const source = '<div data-type="statblock">\n\n### Orc\n\n| STR | DEX |\n| --- | --- |\n| 16 | 12 |\n\n</div>'
    const e = createEditor(source)
    expect(countOf(e, 'statblock')).toBe(1)
    expect(countOf(e, 'table')).toBe(1)

    const again = createEditor(markdownOf(e))
    expect(countOf(again, 'statblock')).toBe(1)
    expect(countOf(again, 'table')).toBe(1)
    expect(countOf(again, 'tableRow')).toBe(2)
  })

  it('preserves columnSpan="all" through save and reload as HTML', () => {
    const source = '<table data-column-span="all"><thead><tr><th>Model</th><th>Gas</th></tr></thead><tbody><tr><td>Wasp</td><td>14</td></tr></tbody></table>'
    const e = createEditor(source)
    expect(countOf(e, 'table')).toBe(1)
    expect(e.state.doc.firstChild?.attrs.columnSpan).toBe('all')

    const saved = markdownOf(e)
    expect(saved).toContain('data-column-span="all"')

    const reloaded = createEditor(saved)
    expect(reloaded.state.doc.firstChild?.attrs.columnSpan).toBe('all')
  })

  it('preserves custom column widths through save and reload as HTML', () => {
    const source = '<table><colgroup><col style="width: 150px;"><col style="width: 300px;"></colgroup><thead><tr><th colwidth="150"><p>Model</p></th><th colwidth="300"><p>Gas</p></th></tr></thead><tbody><tr><td colwidth="150"><p>Wasp</p></td><td colwidth="300"><p>14</p></td></tr></tbody></table>'
    const e = createEditor(source)
    const saved = markdownOf(e)
    expect(saved).toContain('colwidth')

    const reloaded = createEditor(saved)
    expect(countOf(reloaded, 'table')).toBe(1)
  })
})

describe('buildTable', () => {
  it('builds a header row plus the requested empty rows, ready to fill', () => {
    const e = createEditor({ type: 'doc', content: [buildTable(['d6', 'Encounter', 'Notes'], 4)] })
    expect(countOf(e, 'tableRow')).toBe(5)
    expect(countOf(e, 'tableHeader')).toBe(3)
    expect(countOf(e, 'tableCell')).toBe(12)
  })

  it('survives a save and reload with its shape intact', () => {
    const first = createEditor({ type: 'doc', content: [buildTable(['d6', 'Encounter'], 3)] })
    const markdown = markdownOf(first)
    expect(markdown.startsWith('| d6 | Encounter |')).toBe(true)

    const reloaded = createEditor(markdown)
    expect(countOf(reloaded, 'tableRow')).toBe(4)
    expect(countOf(reloaded, 'tableHeader')).toBe(2)
  })
})
