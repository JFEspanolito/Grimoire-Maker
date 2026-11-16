import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/react'
import { EDITOR_EXTENSIONS } from '../editorExtensions'

let editor: Editor | null = null

const markdownOf = (e: Editor): string =>
  (e.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown()

function roundTrip(input: string | object): string {
  editor?.destroy()
  editor = new Editor({ element: document.createElement('div'), extensions: EDITOR_EXTENSIONS, content: input })
  return markdownOf(editor).trim()
}

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('saving keeps the Markdown syntax the author wrote', () => {
  it.each([
    ['asterisk bullets', '* one\n* two\n  * nested'],
    ['plus bullets', '+ one\n+ two'],
    ['dash bullets', '- one\n- two'],
    ['mixed bullets per list', '* one\n  - nested\n* two'],
    ['underscore and asterisk emphasis', 'a *one* and _two_'],
    ['underscore and asterisk strong', 'a **one** and __two__'],
    ['setext level 1 heading', 'Title\n====='],
    ['setext level 2 heading', 'Sub\n---'],
    ['ATX headings', '# Title\n\n## Sub'],
    ['two-space hard break', 'line one  \nline two'],
    ['backslash hard break', 'line one\\\nline two'],
  ])('%s', (_name, input) => {
    expect(roundTrip(input)).toBe(input)
  })

  it('stays stable across repeated saves', () => {
    const input = '* one\n\nTitle\n=====\n\na _b_ __c__  \nd'
    const once = roundTrip(input)
    expect(roundTrip(once)).toBe(once)
  })

  it('uses the default syntax for content created in the editor', () => {
    const text = (value: string, marks?: object[]) => ({ type: 'text', text: value, ...(marks ? { marks } : {}) })
    const output = roundTrip({
      type: 'doc',
      content: [{ type: 'section', content: [
        { type: 'heading', attrs: { level: 1 }, content: [text('Title')] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [text('item')] }] }] },
        { type: 'paragraph', content: [text('a'), text('b', [{ type: 'italic' }]), text(' '), text('c', [{ type: 'bold' }]), { type: 'hardBreak' }, text('d')] },
      ] }],
    })
    expect(output).toBe('# Title\n\n- item\n\na*b* **c**\\\nd')
  })

  it('moves enclosing spaces outside a mark that keeps its source delimiter', () => {
    const output = roundTrip({
      type: 'doc',
      content: [{ type: 'section', content: [{ type: 'paragraph', content: [
        { type: 'text', text: 'a' },
        { type: 'text', text: ' b ', marks: [{ type: 'italic', attrs: { markup: '_' } }] },
        { type: 'text', text: 'c' },
      ] }] }],
    })
    expect(output).toBe('a _b_ c')
  })
})
