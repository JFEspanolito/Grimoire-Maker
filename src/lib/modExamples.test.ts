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
import readme from '../../README.md?raw'

it('lists every TTRPG rulebook chapter under its actual directory in Contents', () => {
  const prefix = 'Templates/ttrpg-core-rulebook/'
  const paths = Object.keys(MOD_EXAMPLES).filter(path => path.startsWith(`${prefix}chapters/`) && path.endsWith('.md'))
  const expected = paths.map(path => path.slice(`${prefix}chapters/`.length).replace(/\.md$/, '')).sort()
  const contents = MOD_EXAMPLES[`${prefix}index.md`].split('## Contents')[1]
  let group = ''
  const listed: string[] = []
  for (const line of contents.split('\n')) {
    const heading = /^- \*\*(.+)\*\*/.exec(line)
    if (heading) group = heading[1]
    const chapter = /^  - (.+)/.exec(line)
    if (chapter) listed.push(`${group}/${chapter[1].trim()}`)
  }
  expect(listed.sort()).toEqual(expected)
})

it('documents the shipped template count and snippet category names', () => {
  const templates = Object.keys(MOD_EXAMPLES).filter(path => /^Templates\/[^/]+\/index\.md$/.test(path))
  expect(readme).toContain(`Built-in Project Templates (${templates.length} Complete Blueprints)`)
  const categories = new Set(Object.keys(MOD_EXAMPLES).filter(path => path.startsWith('Snippets/')).map(path => path.split('/')[1]))
  for (const category of categories) expect(readme).toContain(category)
  expect(readme).not.toContain('Rol Adventures')
})

it('ships consistently named English snippet categories and labels', () => {
  const paths = Object.keys(MOD_EXAMPLES).filter(path => path.startsWith('Snippets/'))
  expect(paths.some(path => path.startsWith('Snippets/Rol Adventures/'))).toBe(false)
  expect(paths.some(path => path.startsWith('Snippets/RPG Adventures/'))).toBe(true)
  expect(parseDocument(MOD_EXAMPLES['Snippets/RPG Adventures/General & Utilities/loot-table-d100.md']).frontmatter.snippetName).toBe('Loot table (d100)')
  expect(parseDocument(MOD_EXAMPLES['Snippets/Zines and Newsletters/figure-caption.md']).frontmatter.snippetName).toBe('Figure caption and copyright')
  for (const name of ['statblock.md', 'character-sheet.md']) {
    const { body } = parseDocument(MOD_EXAMPLES[`Snippets/RPG Adventures/Hitos/${name}`])
    expect(body).not.toMatch(/\b(?:FOR|VOL|RD)\b/)
    expect(body).toContain('STR')
    expect(body).toContain('WIL')
  }
})

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
    expect(snippetPaths).toHaveLength(50)
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
