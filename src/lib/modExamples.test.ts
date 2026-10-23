import { Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import { expect, it } from 'vitest'
import { CharacterSheet, ReadAloud, Statblock } from '../components/editor/extensions/blocks'
import { TableExtensions } from '../components/editor/extensions/tables'
import { MOD_EXAMPLES } from './modLibrary'
import { parseDocument } from './frontmatter'

it('inserts editable D&D Markdown blocks and tables without executing script content', () => {
  const editor = new Editor({ extensions: [StarterKit, CharacterSheet, ReadAloud, Statblock, ...TableExtensions, Markdown.configure({ html: true })] })
  try {
    for (const name of ['character-sheet', 'statblock', 'read-aloud', 'loot-table', 'encounter-table']) {
      editor.commands.insertContent(parseDocument(MOD_EXAMPLES[`Snippets/Dungeons and Dragons/${name}.md`]).body)
    }
    const json = JSON.stringify(editor.getJSON())
    expect(json).toContain('"type":"characterSheet"')
    expect(json).toContain('"type":"statblock"')
    expect(json).toContain('"type":"readAloud"')
    expect(editor.view.dom.querySelectorAll('table')).toHaveLength(4)
    editor.commands.insertContent('<script>window.untrustedModExecuted = true</script><p onclick="alert(1)">Safe text</p>')
    expect(editor.view.dom.querySelector('script, [onclick]')).toBeNull()
    expect(Reflect.get(window, 'untrustedModExecuted')).toBeUndefined()
  } finally { editor.destroy() }
})
