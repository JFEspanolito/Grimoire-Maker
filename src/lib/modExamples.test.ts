import { Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import TextAlign from '@tiptap/extension-text-align'
import { Color, FontSize, TextStyle } from '@tiptap/extension-text-style'
import { Markdown } from 'tiptap-markdown'
import { expect, it } from 'vitest'
import { CharacterSheet, ReadAloud, Statblock } from '../components/editor/extensions/blocks'
import { BlockFormat } from '../components/editor/extensions/blockFormat'
import { ContentBox } from '../components/editor/extensions/ContentBox'
import { TableExtensions } from '../components/editor/extensions/tables'
import { insertContentBox } from './contentBoxes'
import { MOD_EXAMPLES } from './modLibrary'
import { parseDocument } from './frontmatter'

it('inserts all shipped default snippets across every category and blocks script execution', () => {
  const editor = new Editor({
    extensions: [
      StarterKit, BlockFormat, TextStyle, Color, FontSize, ContentBox,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      CharacterSheet, ReadAloud, Statblock, ...TableExtensions, Markdown.configure({ html: true }),
    ],
    editorProps: { handleScrollToSelection: () => true },
  })
  try {
    const snippetPaths = Object.keys(MOD_EXAMPLES).filter((path) => path.startsWith('Snippets/')).sort()
    expect(snippetPaths).toHaveLength(26)
    for (const path of snippetPaths) {
      const { frontmatter, body } = parseDocument(MOD_EXAMPLES[path])
      expect(typeof frontmatter.snippetName).toBe('string')
      expect(insertContentBox(editor, body)).toBe(true)
    }
    const json = JSON.stringify(editor.getJSON())
    expect(json).toContain('"type":"characterSheet"')
    expect(json).toContain('"type":"statblock"')
    expect(json).toContain('"type":"readAloud"')
    expect((json.match(/"type":"table"/g) ?? []).length).toBeGreaterThanOrEqual(8)
    editor.commands.insertContent('<script>window.untrustedModExecuted = true</script><p onclick="alert(1)">Safe text</p>')
    expect(editor.view.dom.querySelector('script, [onclick]')).toBeNull()
    expect(Reflect.get(window, 'untrustedModExecuted')).toBeUndefined()
  } finally { editor.destroy() }
})
