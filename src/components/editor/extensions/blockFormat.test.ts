import { afterEach, expect, it } from 'vitest'
import { Editor } from '@tiptap/react'
import { EDITOR_EXTENSIONS } from '../editorExtensions'
import { canChangeIndent, changeIndent } from './blockFormat'

let editor: Editor | null = null
afterEach(() => { editor?.destroy(); editor = null })
const create = (content: string) => (editor = new Editor({ extensions: EDITOR_EXTENSIONS, content }))
const markdown = (value: Editor) => (value.storage as unknown as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown()

it('keeps plain paragraphs and headings as ordinary Markdown', () => {
  expect(markdown(create('# Title\n\nPlain **text**'))).toBe('# Title\n\nPlain **text**')
})

it('keeps alignment, indentation, color and size when the page is saved and reopened', () => {
  create('Hello world')
  editor!.chain().selectAll().setTextAlign('center').updateAttributes('paragraph', { indent: 2 }).setColor('#ff0000').setFontSize('18px').run()
  const saved = markdown(editor!)
  expect(saved).toContain('text-align: center')
  expect(saved).toContain('data-indent="2"')
  expect(saved).toContain('color: rgb(255, 0, 0)')
  const reopened = create(saved)
  expect(reopened.getAttributes('paragraph')).toMatchObject({ textAlign: 'center', indent: 2 })
  expect(reopened.getAttributes('textStyle')).toMatchObject({ fontSize: '18px' })
  expect(markdown(reopened)).toBe(saved)
})

it('keeps an aligned heading as a heading', () => {
  create('# Title')
  editor!.chain().selectAll().setTextAlign('right').run()
  const reopened = create(markdown(editor!))
  expect(reopened.getAttributes('heading')).toMatchObject({ level: 1, textAlign: 'right' })
})

it('indents blocks one step at a time and moves list items instead', () => {
  create('Text')
  expect(canChangeIndent(editor!, -1)).toBe(false)
  changeIndent(editor!, 1)
  changeIndent(editor!, 1)
  expect(editor!.getAttributes('paragraph').indent).toBe(2)
  changeIndent(editor!, -1)
  expect(editor!.getAttributes('paragraph').indent).toBe(1)
  create('- one\n- two')
  editor!.commands.setTextSelection(editor!.state.doc.content.size - 2)
  expect(canChangeIndent(editor!, 1)).toBe(true)
  changeIndent(editor!, 1)
  expect(markdown(editor!)).toContain('  - two')
  expect(editor!.getAttributes('paragraph').indent ?? 0).toBe(0)
})
