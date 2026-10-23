import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import { CharacterSheet, ReadAloud, Statblock } from '../editor/extensions/blocks'
import { TableExtensions } from '../editor/extensions/tables'
import { SNIPPETS, findSnippet } from './snippets'

let editor: Editor | null = null

function createEditor(content?: string): Editor {
  editor = new Editor({
    element: document.createElement('div'),
    extensions: [
      StarterKit,
      ...TableExtensions,
      Statblock,
      ReadAloud,
      CharacterSheet,
      Markdown.configure({ html: true }),
    ],
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

function countOf(e: Editor, type: string): number {
  let count = 0
  e.state.doc.descendants((node) => {
    if (node.type.name === type) count++
  })
  return count
}

describe('character sheet', () => {
  it('is one block holding an attribute grid and a combat grid', () => {
    const e = createEditor()
    e.commands.insertContent(findSnippet('character-sheet').node)
    expect(countOf(e, 'characterSheet')).toBe(1)
    expect(countOf(e, 'table')).toBe(2)
    const markdown = markdownOf(e)
    expect(markdown).toContain('<div data-type="character-sheet">')
    expect(markdown).toContain('| STR | DEX | CON | INT | WIS | CHA |')
    expect(markdown).toContain('| AC | HP | Speed | Initiative |')
  })

  it('keeps edited attribute values after a save and reload', () => {
    const first = createEditor()
    first.commands.insertContent(findSnippet('character-sheet').node)
    const edited = markdownOf(first).replace('| 10 | 10 | 10 | 10 | 10 | 10 |', '| 16 | 14 | 15 | 8 | 12 | 10 |')
    expect(edited).toContain('| 16 | 14 | 15 | 8 | 12 | 10 |')

    const reloaded = createEditor(edited)
    expect(countOf(reloaded, 'characterSheet')).toBe(1)
    expect(countOf(reloaded, 'table')).toBe(2)
    expect(markdownOf(reloaded)).toContain('| 16 | 14 | 15 | 8 | 12 | 10 |')
  })
})
