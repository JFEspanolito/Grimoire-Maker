import { afterEach, expect, it } from 'vitest'
import { Editor } from '@tiptap/react'
import { EDITOR_EXTENSIONS } from '../editorExtensions'
import { insertFloatingBox } from '../../../lib/insertActions'
import { boxAttributes, boxBackgroundColor, boxBackgroundInputValue, boxBorderColor, boxBorderWidth } from './ContentBox'

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

it('only accepts #rgb, #rrggbb and #rrggbbaa as a background color', () => {
  expect(boxBackgroundColor('#FFF')).toBe('#fff')
  expect(boxBackgroundColor('#A1B2C3')).toBe('#a1b2c3')
  expect(boxBackgroundColor('#a1b2c380')).toBe('#a1b2c380')
  for (const bad of ['red', 'url(x)', 'var(--x)', '#ff', '#ffff', '#fffff', '#ggg', '#fff;color:red', '#fff ', ' #fff', '"#fff"', 'rgb(0,0,0)', '', null, undefined, 5]) expect(boxBackgroundColor(bad)).toBeNull()
  expect(boxBackgroundInputValue('#abc')).toBe('#aabbcc')
  expect(boxBackgroundInputValue('#11223344')).toBe('#112233')
  expect(boxBackgroundInputValue(null)).toBe('#ffffff')
})

it('serializes the background like the sibling attributes and leaves old boxes untouched', () => {
  const plain = boxAttributes({ placement: 'flow', borderWidth: null })
  expect(plain).not.toHaveProperty('data-bg-color')
  expect(plain.style).not.toContain('background')
  const colored = boxAttributes({ placement: 'flow', backgroundColor: '#FFEECC' })
  expect(colored['data-bg-color']).toBe('#ffeecc')
  expect(colored.style).toContain('background-color:#ffeecc;')
  expect(boxAttributes({ placement: 'flow', backgroundColor: 'url(x);color:red' })).not.toHaveProperty('data-bg-color')
})

it('round-trips the background through Markdown, rejects an injected value, and keeps old documents as they were', () => {
  editor = new Editor({ extensions: EDITOR_EXTENSIONS, content: 'Body' })
  insertFloatingBox(editor)
  const box = () => editor!.getJSON().content?.[0].content?.find((node) => node.type === 'standardContentBox')
  expect(box()?.attrs?.backgroundColor).toBeNull()
  expect(markdown(editor)).not.toContain('data-bg-color')
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'standardContentBox') editor!.view.dispatch(editor!.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, backgroundColor: '#ffeecc' }))
  })
  const saved = markdown(editor)
  expect(saved).toContain('data-bg-color="#ffeecc"')
  expect(saved).toContain('background-color:#ffeecc')
  const reopened = new Editor({ extensions: EDITOR_EXTENSIONS, content: saved })
  expect(reopened.getJSON().content?.[0].content?.find((node) => node.type === 'standardContentBox')?.attrs).toMatchObject({ backgroundColor: '#ffeecc', borderWidth: 2 })
  reopened.destroy()
  const hostile = new Editor({ extensions: EDITOR_EXTENSIONS, content: '<div data-type="standard-content-box" data-bg-color="url(javascript:x)"><p>x</p></div>' })
  expect(hostile.getJSON().content?.[0].content?.find((node) => node.type === 'standardContentBox')?.attrs?.backgroundColor).toBeNull()
  expect(markdown(hostile)).not.toContain('url(')
  hostile.destroy()
})
