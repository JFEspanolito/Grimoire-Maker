import { Editor, Node } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { applyFormula, insertImage, newImageAttrs } from './insertActions'
import { importImage } from './images'
import { useDocumentStore } from '../stores/documentStore'

vi.mock('./images', () => ({ importImage: vi.fn() }))
const editors: Editor[] = []
const formula = Node.create({ name: 'mathFormula', group: 'block', atom: true,
  addAttributes: () => ({ latex: { default: '' }, display: { default: 'block' } }),
  parseHTML: () => [{ tag: 'math' }], renderHTML: () => ['math'],
})
const createEditor = () => { const editor = new Editor({ extensions: [StarterKit, formula], content: '<p>Text</p>' }); editors.push(editor); return editor }
beforeEach(() => { vi.resetAllMocks(); useDocumentStore.getState().resetDocuments() })
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()) })

it('inserts and edits a formula in the document without duplicating the selected node', () => {
  const editor = createEditor()
  expect(applyFormula(editor, 'x^2')).toBe(true)
  let formulaPosition = 0
  editor.state.doc.descendants((node, pos) => { if (node.type.name === 'mathFormula') formulaPosition = pos })
  expect(applyFormula(editor, 'y^2', 'inline', formulaPosition)).toBe(true)
  const formulas: unknown[] = []
  editor.state.doc.descendants(node => { if (node.type.name === 'mathFormula') formulas.push(node.attrs) })
  expect(formulas).toEqual([{ latex: 'y^2', display: 'inline' }])
  editor.destroy()
  expect(applyFormula(editor, 'z')).toBe(false)
})

it('requires a saved document before opening the image importer', async () => {
  await expect(insertImage(createEditor())).rejects.toThrow('Save this document as Markdown')
  expect(importImage).not.toHaveBeenCalled()
  expect(newImageAttrs('assets/My portrait.png')).toMatchObject({ alt: 'My portrait', widthMm: 55, anchor: 'flow' })
})

it('does not insert an image when its editor is destroyed during the picker', async () => {
  useDocumentStore.getState().loadFromRaw('/book/chapter.md', '# Chapter')
  let choose!: (src: string) => void
  vi.mocked(importImage).mockImplementation(() => new Promise(resolve => { choose = resolve }))
  const editor = createEditor()
  const original = editor.getJSON()
  const pending = insertImage(editor)
  editor.destroy(); choose('assets/portrait.png'); await pending
  expect(importImage).toHaveBeenCalledWith('/book/chapter.md', null)
  expect(editor.getJSON()).toEqual(original)
})
