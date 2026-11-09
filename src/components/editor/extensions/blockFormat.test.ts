import { afterEach, expect, it } from 'vitest'
import { Editor } from '@tiptap/react'
import { EDITOR_EXTENSIONS } from '../editorExtensions'
import { canChangeIndent, changeIndent, continueListNumbering, isBlockColumnSpanned, restartListNumbering, setListStart, toggleBlockColumnSpan, toggleOrderedListSmart } from './blockFormat'

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

it('nests a bullet list into a preceding ordered list item when indent is clicked on the first bullet', () => {
  create('1. Reinicio y Siembra:\n\n- Efectos de inicio de turno.\n- Endereza todas tus cartas agotadas.')
  // Select first bullet item:
  let bulletPos = -1
  editor!.state.doc.descendants((node, pos) => {
    if (node.isText && node.text?.includes('Efectos')) bulletPos = pos
  })
  editor!.commands.setTextSelection(bulletPos + 2)
  expect(canChangeIndent(editor!, 1)).toBe(true)
  changeIndent(editor!, 1)
  const md = markdown(editor!)
  expect(md).toContain('1. Reinicio y Siembra:\n   - Efectos de inicio de turno.')
  expect(editor!.getHTML()).toContain('<ol class="tight" data-tight="true"><li><p>Reinicio y Siembra:</p><ul class="tight" data-tight="true">')
})

it('smart toggles ordered list to continue numbering across an intervening paragraph', () => {
  create('<ol><li><p>Titular 1</p></li></ol><p>parrafo info</p><p>Titular 2</p>')
  let t2Pos = -1
  editor!.state.doc.descendants((node, pos) => {
    if (node.isText && node.text === 'Titular 2') t2Pos = pos
  })
  editor!.commands.setTextSelection(t2Pos + 1)
  toggleOrderedListSmart(editor!)
  expect(editor!.getHTML()).toContain('start="2"')
  expect(markdown(editor!)).toContain('2. Titular 2')
})

it('allows setting start number, restarting at 1, and continuing from previous list', () => {
  create('<ol><li><p>Item 1</p></li></ol><p>Middle</p><ol><li><p>Item 2</p></li></ol>')
  let item2Pos = -1
  editor!.state.doc.descendants((node, pos) => {
    if (node.isText && node.text === 'Item 2') item2Pos = pos
  })
  editor!.commands.setTextSelection(item2Pos + 1)

  // Explicit start
  setListStart(editor!, 5)
  expect(editor!.getHTML()).toContain('start="5"')
  expect(markdown(editor!)).toContain('5. Item 2')

  // Restart at 1
  restartListNumbering(editor!)
  expect(editor!.getAttributes('orderedList').start).toBe(1)
  expect(markdown(editor!)).toContain('1. Item 2')

  // Continue from previous list (which had 1 item, so next is 2)
  continueListNumbering(editor!)
  expect(editor!.getHTML()).toContain('start="2"')
  expect(markdown(editor!)).toContain('2. Item 2')
})

it('toggles column span on headings and paragraphs and preserves it through save/load', () => {
  create('## 4. Modelos de Dron\n\nCada modelo cuenta con estadísticas')
  editor!.commands.setTextSelection(5)
  expect(isBlockColumnSpanned(editor!)).toBe(false)
  toggleBlockColumnSpan(editor!)
  expect(isBlockColumnSpanned(editor!)).toBe(true)
  expect(editor!.getAttributes('heading').columnSpan).toBe('all')

  const saved = markdown(editor!)
  expect(saved).toContain('data-column-span="all"')
  expect(saved).toContain('4. Modelos de Dron')

  const reopened = create(saved)
  expect(reopened.getAttributes('heading').columnSpan).toBe('all')
  expect(isBlockColumnSpanned(reopened)).toBe(true)

  // Toggle off reverts to plain markdown
  toggleBlockColumnSpan(reopened)
  expect(reopened.getAttributes('heading').columnSpan).toBeNull()
  expect(markdown(reopened)).toContain('## 4. Modelos de Dron')
  expect(markdown(reopened)).not.toContain('data-column-span="all"')
})

it('toggles column span on horizontalRule and preserves it through save/load', () => {
  create('Before\n\n---\n\nAfter')
  let hrPos = -1
  editor!.state.doc.descendants((node, pos) => {
    if (node.type.name === 'horizontalRule') hrPos = pos
  })
  expect(hrPos).toBeGreaterThanOrEqual(0)
  editor!.commands.setNodeSelection(hrPos)
  expect(isBlockColumnSpanned(editor!)).toBe(false)
  toggleBlockColumnSpan(editor!)
  expect(isBlockColumnSpanned(editor!)).toBe(true)
  expect(editor!.state.doc.nodeAt(hrPos)?.attrs.columnSpan).toBe('all')

  const saved = markdown(editor!)
  expect(saved).toContain('data-column-span="all"')
  expect(saved).toContain('<hr')

  const reopened = create(saved)
  let reopenedHrPos = -1
  reopened.state.doc.descendants((node, pos) => {
    if (node.type.name === 'horizontalRule') reopenedHrPos = pos
  })
  expect(reopened.state.doc.nodeAt(reopenedHrPos)?.attrs.columnSpan).toBe('all')

  reopened.commands.setNodeSelection(reopenedHrPos)
  toggleBlockColumnSpan(reopened)
  expect(reopened.state.doc.nodeAt(reopenedHrPos)?.attrs.columnSpan).toBeNull()
  expect(markdown(reopened)).toContain('---')
  expect(markdown(reopened)).not.toContain('data-column-span="all"')
})
