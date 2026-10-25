import { afterEach, expect, it } from 'vitest'
import { Editor } from '@tiptap/react'
import { EDITOR_EXTENSIONS } from '../editorExtensions'
import { insertFloatingBox } from '../../../lib/insertActions'
import { boxAttributes, boxBorderColor, boxBorderWidth } from './ContentBox'

let editor: Editor | null = null
afterEach(() => { editor?.destroy(); editor = null })
const markdown = (value: Editor) => (value.storage as unknown as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown()

it('inserts a free box with a 2 px black border that survives saving and reopening', () => {
  editor = new Editor({ extensions: EDITOR_EXTENSIONS, content: 'Body text' })
  expect(insertFloatingBox(editor)).toBe(true)
  const box = editor.getJSON().content?.[0].content?.find((node) => node.type === 'standardContentBox')
  expect(box?.attrs).toMatchObject({ placement: 'free', widthMm: 60, borderWidth: 2, borderColor: '#000000' })
  const saved = markdown(editor)
  expect(saved).toContain('data-border-width="2"')
  expect(saved).toContain('border:2px solid #000000')
  const reopened = new Editor({ extensions: EDITOR_EXTENSIONS, content: saved })
  expect(reopened.getJSON().content?.[0].content?.find((node) => node.type === 'standardContentBox')?.attrs).toMatchObject({ placement: 'free', borderWidth: 2, borderColor: '#000000' })
  reopened.destroy()
})

it('only accepts a plain hex color and a small whole border width', () => {
  expect(boxBorderColor('#FF0000')).toBe('#ff0000')
  expect(boxBorderColor('red;background:url(x)')).toBe('#000000')
  expect(boxBorderWidth(0)).toBeNull()
  expect(boxBorderWidth(99)).toBe(12)
  expect(boxBorderWidth('2.4')).toBe(2)
  expect(boxAttributes({ placement: 'flow', borderWidth: null, borderColor: '#000000' }).style).not.toContain('border')
})
