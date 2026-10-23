import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import { GrimoireImage } from './image'

let editor: Editor | null = null

function createEditor(content: string | object): Editor {
  editor = new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit, GrimoireImage, Markdown.configure({ html: true })],
    content,
  })
  return editor
}

const markdownOf = (e: Editor): string =>
  (e.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown()

const firstImage = (e: Editor): Record<string, unknown> => {
  let attrs: Record<string, unknown> = {}
  e.state.doc.descendants((node) => {
    if (node.type.name === 'image') attrs = node.attrs
  })
  return attrs
}

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('GrimoireImage markdown', () => {
  it('keeps an unstyled image as plain Markdown between paragraphs', () => {
    const e = createEditor('Before\n\n![A map](assets/map.png)\n\nAfter')
    expect(markdownOf(e)).toBe('Before\n\n![A map](assets/map.png)\n\nAfter')
    expect(firstImage(e)).toMatchObject({
      src: 'assets/map.png',
      alt: 'A map',
      align: 'none',
      widthMm: null,
      frame: 'none',
      opacity: 1,
      anchor: 'flow',
    })
  })

  it('writes styled images as HTML and reads every attribute back', () => {
    const styled = {
      src: 'assets/orc.png',
      alt: 'Orc "chief"',
      align: 'right',
      widthMm: 60,
      frame: 'double',
      opacity: 0.5,
      anchor: 'flow',
    }
    const first = createEditor({ type: 'doc', content: [{ type: 'image', attrs: styled }] })
    const markdown = markdownOf(first)
    expect(markdown).toContain('<img')
    expect(markdown).toContain('data-align="right"')

    const second = createEditor(markdown)
    expect(firstImage(second)).toMatchObject(styled)
  })

  it('round-trips each page anchor', () => {
    for (const anchor of ['header', 'footer', 'background']) {
      const attrs = { src: 'assets/bg.png', anchor, opacity: 0.25 }
      const source = createEditor({ type: 'doc', content: [{ type: 'image', attrs }] })
      const reread = createEditor(markdownOf(source))
      expect(firstImage(reread)).toMatchObject({ anchor, opacity: 0.25 })
    }
  })

  it('round-trips a freely placed image inside the sheet', () => {
    const attrs = { src: 'assets/map.png', anchor: 'free', xMm: 42.5, yMm: 91.25 }
    const source = createEditor({ type: 'doc', content: [{ type: 'image', attrs }] })
    const markdown = markdownOf(source)
    expect(markdown).toContain('data-x-mm="42.5"')
    expect(markdown).toContain('data-y-mm="91.25"')

    const reread = createEditor(markdown)
    expect(firstImage(reread)).toMatchObject(attrs)
  })

  it('does not leak attribute-breaking characters from alt text', () => {
    const attrs = { src: 'a.png', alt: '"><script>x</script>', align: 'left' }
    const markdown = markdownOf(
      createEditor({ type: 'doc', content: [{ type: 'image', attrs }] }),
    )
    expect(markdown).not.toContain('<script>')
    expect(firstImage(createEditor(markdown)).alt).toBe('"><script>x</script>')
  })
})
