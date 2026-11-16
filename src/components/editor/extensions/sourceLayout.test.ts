import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/react'
import { EDITOR_EXTENSIONS } from '../editorExtensions'

let editor: Editor | null = null

const markdownOf = (e: Editor): string =>
  (e.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown()

function roundTrip(input: string): string {
  editor?.destroy()
  editor = new Editor({ element: document.createElement('div'), extensions: EDITOR_EXTENSIONS, content: input })
  return markdownOf(editor).trim()
}

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('saving keeps entities, escapes, reference links and blank lines', () => {
  it.each([
    ['named and numeric entities', 'AT&amp;T &copy; &nbsp;x &#169;'],
    ['backslash escapes', 'not \\*emph\\* and 2 \\< 3 and \\#tag'],
    ['full, collapsed and shortcut reference links', '[ref][1], [other][] and [short]\n\n[1]: https://x.y\n[other]: https://o.y "Title"\n[short]: https://s.y'],
    ['extra blank lines between blocks', 'para one\n\n\n\npara two\n\n\n# Heading'],
    ['blank lines around lists and quotes', '- a\n- b\n\n\n> quote\n\n\n\ntext'],
  ])('%s', (_name, input) => {
    expect(roundTrip(input)).toBe(input)
  })

  it('shows entities and escapes as their characters', () => {
    roundTrip('a &copy; b \\< c')
    expect(editor!.view.dom.textContent).toContain('a © b < c')
    expect(editor!.state.doc.textContent).toBe('a © b < c')
  })

  it('keeps reference links as links to their resolved address', () => {
    roundTrip('[ref][1]\n\n[1]: https://x.y')
    expect(editor!.view.dom.querySelector('a')?.getAttribute('href')).toBe('https://x.y')
  })

  it('writes an inline link once its address no longer matches the reference', () => {
    roundTrip('[ref][1]\n\n[1]: https://x.y')
    editor!.chain().selectAll().extendMarkRange('link').setLink({ href: 'https://new.y' }).run()
    expect(markdownOf(editor!).trim()).toBe('[ref](https://new.y)\n\n[1]: https://x.y')
  })

  it('stays stable across repeated saves', () => {
    const input = 'a &copy; [r][1]\n\n\n\n- x\n\n[1]: https://x.y'
    const once = roundTrip(input)
    expect(roundTrip(once)).toBe(once)
  })

  it('gives a block split off with Enter the usual single blank line', () => {
    roundTrip('one\n\n\n\ntwo')
    editor!.commands.focus('end')
    editor!.commands.splitBlock()
    editor!.commands.insertContent('three')
    expect(markdownOf(editor!).trim()).toBe('one\n\n\n\ntwo\n\nthree')
  })
})
