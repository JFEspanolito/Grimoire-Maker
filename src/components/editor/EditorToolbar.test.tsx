import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import sheetStyles from '../../styles/index.css?raw'
import preflight from 'tailwindcss/preflight.css?raw'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { useDocumentStore } from '../../stores/documentStore'
import { importImage } from '../../lib/images'
import { EditorToolbar } from './EditorToolbar'
import { GrimoireImage } from './extensions/image'

const saveFile = vi.hoisted(() => vi.fn())
vi.mock('../../hooks/useFileSystem', () => ({ useFileSystem: () => ({ saveFile }) }))
vi.mock('../../lib/images', () => ({ importImage: vi.fn() }))

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
    ['Quote', 'blockquote', 'borderLeftWidth', '3px', '> Sample text'],
    ['Divider', 'hr', 'borderTopWidth', '2px', '---'],
  ])('%s applies a visible block and persists Markdown', async (label, selector, property, expectedStyle, markdown) => {
    const toolbar = await mountToolbar()
    if (selector === 'hr') editor!.commands.setTextSelection(12)
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

describe('image insertion', () => {
  it('asks to save an unsaved document instead of opening a Markdown picker as if it were the image picker', async () => {
    useDocumentStore.getState().loadFromRaw(null, '')
    editor = new Editor({ element: document.createElement('div'), extensions: [StarterKit] })
    const container = document.createElement('div')
    root = createRoot(container)
    await act(async () => root?.render(<EditorToolbar editor={editor} />))

    await act(async () => container.querySelector<HTMLButtonElement>('button[title^="Insert image"]')?.click())

    expect(container.textContent).toContain('Save this document as Markdown before importing an image.')
    expect(saveFile).not.toHaveBeenCalled()
    expect(importImage).not.toHaveBeenCalled()
  })

  it('opens the image picker for a saved document', async () => {
    useDocumentStore.getState().loadFromRaw('/workspace/Draft/Chapter.md', '')
    vi.mocked(importImage).mockResolvedValue(null)
    editor = new Editor({ element: document.createElement('div'), extensions: [StarterKit] })
    const container = document.createElement('div')
    root = createRoot(container)
    await act(async () => root?.render(<EditorToolbar editor={editor} />))

    await act(async () => container.querySelector<HTMLButtonElement>('button[title^="Insert image"]')?.click())

    expect(importImage).toHaveBeenCalledWith('/workspace/Draft/Chapter.md')
    expect(saveFile).not.toHaveBeenCalled()
  })
})
