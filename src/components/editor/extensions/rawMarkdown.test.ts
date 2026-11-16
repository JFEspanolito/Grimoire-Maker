import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/react'
import { EDITOR_EXTENSIONS } from '../editorExtensions'

let editor: Editor | null = null

const markdownOf = (e: Editor): string =>
  (e.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown()

/** Open → serialize, as the first edit of a document does before autosave writes it. */
function roundTrip(input: string): string {
  editor = new Editor({ element: document.createElement('div'), extensions: EDITOR_EXTENSIONS, content: input })
  return markdownOf(editor).trim()
}

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('Markdown the editor cannot represent survives a round trip', () => {
  it.each([
    ['HTML comments', 'text\n\n<!-- note -->\n\nafter'],
    ['unknown block HTML', '<div class="x">hi</div>'],
    ['unknown inline HTML', 'H<sub>2</sub>O and <kbd>Ctrl</kbd>'],
    ['footnotes', 'Claim[^1]\n\n[^1]: Source'],
    ['task list markers', '- [ ] todo\n- [x] done'],
    ['wikilinks', 'see [[Other Page]]'],
  ])('%s', (_name, input) => {
    expect(roundTrip(input)).toBe(input)
  })

  it('keeps table column alignment', () => {
    const output = roundTrip('| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |')
    expect(output.split('\n')[1]).toBe('| :-- | :-: | --: |')
  })

  it('keeps preserved content stable across repeated saves', () => {
    const input = 'Claim[^1] see [[Page]]\n\n<!-- note -->\n\n[^1]: Source\n\n- [x] done'
    const once = roundTrip(input)
    editor?.destroy()
    expect(roundTrip(once)).toBe(once)
  })

  it('marks only comments as unprintable', () => {
    roundTrip('<!-- note -->\n\nsee [[Page]]')
    const dom = editor!.view.dom
    expect(dom.querySelectorAll('.grimoire-raw-markdown-comment')).toHaveLength(1)
    expect(dom.querySelector('.grimoire-raw-markdown-comment')?.textContent).toBe('<!-- note -->')
    expect(dom.querySelector('span.grimoire-raw-markdown')?.classList.contains('grimoire-raw-markdown-comment')).toBe(false)
  })

  it('still parses project HTML into editor nodes', () => {
    const input = '<div data-type="statblock">\n\n## Goblin\n\n</div>\n\nH<span data-type="math-formula" data-latex="x^2" data-display="false"></span>'
    roundTrip(input)
    const types = new Set<string>()
    editor!.state.doc.descendants(node => { types.add(node.type.name) })
    expect(types).toContain('statblock')
    expect(types).toContain('mathFormula')
    expect(types).not.toContain('rawMarkdownBlock')
    expect(types).not.toContain('rawMarkdownInline')
  })
})
