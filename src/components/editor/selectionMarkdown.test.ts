import { Editor } from '@tiptap/react'
import { afterEach, expect, it } from 'vitest'
import { EDITOR_EXTENSIONS } from './editorExtensions'
import { selectionMarkdown } from './selectionMarkdown'

let editor: Editor
afterEach(() => editor.destroy())
const make = (content: string) => { editor = new Editor({ extensions: EDITOR_EXTENSIONS, content }); return editor }

it('returns the selected slice as Markdown and nothing for a bare cursor in plain text', () => {
  make('Alpha **bold**\n\nBeta')
  editor.commands.setTextSelection(2)
  expect(selectionMarkdown(editor)).toBe('')
  editor.commands.selectAll()
  expect(selectionMarkdown(editor)).toBe('Alpha **bold**\n\nBeta')
})

it('returns only the selected words, keeping their formatting', () => {
  make('Alpha **bold** tail')
  editor.commands.setTextSelection({ from: 8, to: 12 })
  expect(selectionMarkdown(editor)).toBe('**bold**')
})

it('returns the whole table when the cursor is inside one', () => {
  make('Intro\n\n| Roll | Foe |\n| --- | --- |\n| 1 | Orc |')
  let cell = 0
  editor.state.doc.descendants((node, pos) => { if (!cell && node.isText && node.text === 'Roll') cell = pos + 1 })
  editor.commands.setTextSelection(cell)
  const markdown = selectionMarkdown(editor)
  expect(markdown).toContain('| Roll | Foe |')
  expect(markdown).toContain('| 1 | Orc |')
  expect(markdown).not.toContain('Intro')
})
