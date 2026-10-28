import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import sheetStyles from '../../styles/index.css?raw'
import preflight from 'tailwindcss/preflight.css?raw'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { useDocumentStore } from '../../stores/documentStore'
import { EditorToolbar } from './EditorToolbar'
import { GrimoireImage } from './extensions/image'
import { TableExtensions } from './extensions/tables'
import { EDITOR_EXTENSIONS } from './editorExtensions'


let root: Root | null = null
let editor: Editor | null = null
let styles: HTMLStyleElement | null = null
let host: HTMLDivElement | null = null
const markdownOf = (value: Editor) => (value.storage as unknown as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown()
beforeAll(() => Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true))

it('keeps the image layout row mounted and empty when the selection leaves the image', async () => {
  editor = new Editor({ extensions: [StarterKit, GrimoireImage], content: '<p>Text</p><img src="map.png" />' })
  const container = document.createElement('div')
  root = createRoot(container)
  await act(async () => root?.render(<EditorToolbar editor={editor} />))
  const row = container.querySelector<HTMLElement>('[aria-label="Image layout"]')
  expect(row).not.toBeNull()
  expect(row!.getAttribute('aria-hidden')).toBe('true')
  expect(row!.hasAttribute('inert')).toBe(true)
  const fields = row!.querySelectorAll('label').length
  expect(fields).toBe(6)
  await act(async () => { editor!.commands.setNodeSelection(6) })
  expect(container.querySelector('[aria-label="Image layout"]')).toBe(row)
  expect(row!.getAttribute('aria-hidden')).toBe('false')
  expect(row!.hasAttribute('inert')).toBe(false)
  await act(async () => { editor!.commands.setTextSelection(1) })
  expect(container.querySelector('[aria-label="Image layout"]')).toBe(row)
  expect(row!.getAttribute('aria-hidden')).toBe('true')
  expect(row!.querySelectorAll('label')).toHaveLength(fields)
  await act(async () => root?.render(<EditorToolbar editor={null} />))
  expect(container.querySelector('[aria-label="Image layout"]')).toBe(row)
  expect(row!.hasAttribute('inert')).toBe(true)
})

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = null
  editor?.destroy()
  editor = null
  styles?.remove()
  host?.remove()
  styles = null
  host = null
  useDocumentStore.getState().loadFromRaw(null, '')
  vi.clearAllMocks()
})

describe('block formatting and underline', () => {
  async function mountToolbar() {
    host = document.createElement('div')
    host.className = 'grimoire-content'
    document.body.append(host)
    const content = document.createElement('div')
    const toolbar = document.createElement('div')
    host.append(content, toolbar)
    styles = document.createElement('style')
    styles.textContent = preflight + sheetStyles.replace(/^@import[^;]+;/gm, '')
    document.head.append(styles)
    editor = new Editor({ element: content, extensions: [StarterKit, Markdown.configure({ html: true })], content: 'Sample text',
      editorProps: { handleScrollToSelection: () => true } })
    editor.commands.setTextSelection({ from: 1, to: 12 })
    root = createRoot(toolbar)
    await act(async () => root?.render(<EditorToolbar editor={editor} />))
    return toolbar
  }

  it.each([
    ['Bulleted list', 'ul', 'listStyle', 'disc outside', '- Sample text'],
    ['Numbered list', 'ol', 'listStyle', 'decimal outside', '1. Sample text'],
  ])('%s applies a visible block and persists Markdown', async (label, selector, property, expectedStyle, markdown) => {
    const toolbar = await mountToolbar()
    await act(async () => toolbar.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)?.click())
    const block = host!.querySelector(selector)
    expect(block).not.toBeNull()
    expect(getComputedStyle(block!).getPropertyValue(property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`))).toBe(expectedStyle)
    expect(markdownOf(editor!)).toContain(markdown)
    expect(editor!.getText()).toContain('Sample text')
  })

  it('toggles underline and preserves it when Markdown is reloaded', async () => {
    const toolbar = await mountToolbar()
    const button = toolbar.querySelector<HTMLButtonElement>('[aria-label="Underline"]')
    expect(button).not.toBeNull()
    await act(async () => button!.click())
    expect(editor!.getHTML()).toContain('<u>Sample text</u>')
    expect(button!.getAttribute('aria-pressed')).toBe('true')
    const markdown = markdownOf(editor!)
    await act(async () => editor!.commands.setContent(markdown))
    expect(editor!.getHTML()).toContain('<u>Sample text</u>')
    await act(async () => { editor!.commands.setTextSelection({ from: 1, to: 12 }); button!.click() })
    expect(editor!.getHTML()).not.toContain('<u>')
  })
})

describe('context row', () => {
  it('shows table tools in the image row slot instead of adding another row', async () => {
    editor = new Editor({ extensions: [StarterKit, GrimoireImage, ...TableExtensions], content: '<p>Text</p>' })
    const container = document.createElement('div')
    root = createRoot(container)
    await act(async () => root?.render(<EditorToolbar editor={editor} />))
    const rows = () => Array.from(container.querySelectorAll('[role="group"][aria-label="Image layout"], [role="group"][aria-label="Table"]'))
    expect(rows().map((row) => row.getAttribute('aria-label'))).toEqual(['Image layout'])
    await act(async () => { editor!.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run() })
    expect(rows().map((row) => row.getAttribute('aria-label'))).toEqual(['Table'])
    await act(async () => { editor!.commands.deleteTable() })
    expect(rows().map((row) => row.getAttribute('aria-label'))).toEqual(['Image layout'])
  })
})

describe('toolbar layout and text controls', () => {
  it('orders the groups with simple separators and offers color, size, alignment and indent', async () => {
    editor = new Editor({ extensions: EDITOR_EXTENSIONS, content: 'Hello world' })
    const container = document.createElement('div')
    root = createRoot(container)
    await act(async () => root?.render(<EditorToolbar editor={editor} />))
    const bar = container.querySelector('[role="toolbar"]')!
    const sequence = Array.from(bar.querySelectorAll('[role="separator"], button, select, input')).filter((item) => !item.closest('details')).map((item) =>
      item.getAttribute('role') === 'separator' ? '//' : item.getAttribute('aria-label') ?? item.textContent)
    expect(sequence).toEqual([
      'Undo', 'Redo', '//', 'Bold', 'Italic', 'Underline', 'Strikethrough', '//',
      'Text color', 'Text size', '//', 'Alignment', 'Heading 1 (starts a new page when printed)', 'Heading 2', 'Heading 3', 'Heading 4', '//',
      'Decrease indent', 'Increase indent', 'Bulleted list', 'Numbered list', 'Insert Formula', '//', 'Find and Replace (Ctrl+F)', 'Page view',
    ])
    const alignment = bar.querySelector<HTMLSelectElement>('[aria-label="Alignment"]')!
    expect(Array.from(alignment.options, (option) => option.textContent)).toEqual(['Left', 'Centered', 'Right', 'Justified'])
  })

  it('applies size, color, alignment and indent to the selection', async () => {
    editor = new Editor({ extensions: EDITOR_EXTENSIONS, content: 'Hello world' })
    editor.commands.selectAll()
    const container = document.createElement('div')
    root = createRoot(container)
    await act(async () => root?.render(<EditorToolbar editor={editor} />))
    const change = (selector: string, value: string) => act(async () => {
      const element = container.querySelector<HTMLSelectElement | HTMLInputElement>(selector)!
      const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value)
      element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
    })
    await change('[aria-label="Text size"]', '20')
    await change('[aria-label="Text color"]', '#336699')
    await change('[aria-label="Alignment"]', 'justify')
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Increase indent"]')!.click())
    expect(editor.getAttributes('textStyle')).toMatchObject({ fontSize: '20px', color: '#336699' })
    expect(editor.getAttributes('paragraph')).toMatchObject({ textAlign: 'justify', indent: 1 })
    expect(container.querySelector<HTMLSelectElement>('[aria-label="Text size"]')!.value).toBe('20')
  })
})
