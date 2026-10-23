import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import { ReadAloud, Statblock } from '../editor/extensions/blocks'
import { TableExtensions } from '../editor/extensions/tables'
import { SNIPPETS, findSnippet } from './snippets'

let editor: Editor | null = null

function createEditor(): Editor {
  editor = new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit, ...TableExtensions, Statblock, ReadAloud, Markdown.configure({ html: true })],
  })
  return editor
}

const markdownOf = (e: Editor): string =>
  (e.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown()

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('snippet catalog', () => {
  it('has unique ids', () => {
    const ids = SNIPPETS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it.each(SNIPPETS.map((s) => [s.id, s] as const))('inserts "%s" into the editor', (_id, snippet) => {
    const e = createEditor()
    expect(e.commands.insertContent(snippet.node)).toBe(true)
    expect(markdownOf(e).trim().length).toBeGreaterThan(0)
  })
})

describe('encounter and loot tables', () => {
  it('encounter table is a numbered d6 grid ready to fill', () => {
    const e = createEditor()
    e.commands.insertContent(findSnippet('encounter-table').node)
    const lines = markdownOf(e).trim().split('\n')
    const table = lines.filter((l) => l.startsWith('|'))
    expect(table[0]).toBe('| d6 | Encounter | Notes |')
    expect(table).toHaveLength(2 + 6)
    expect(table.slice(2).map((row) => row.split('|')[1].trim())).toEqual(['1', '2', '3', '4', '5', '6'])
  })

  it('loot table uses d100 ranges that cover 01-00 without gaps', () => {
    const e = createEditor()
    e.commands.insertContent(findSnippet('loot-table').node)
    const rows = markdownOf(e)
      .split('\n')
      .filter((l) => l.startsWith('|'))
      .slice(2)
      .map((row) => row.split('|')[1].trim())
    expect(rows[0].startsWith('01')).toBe(true)
    expect(rows.at(-1)?.endsWith('00')).toBe(true)
    expect(rows.length).toBeGreaterThanOrEqual(4)
  })
})
