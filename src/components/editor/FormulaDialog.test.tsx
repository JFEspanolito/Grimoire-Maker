import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Editor } from '@tiptap/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { EDITOR_EXTENSIONS } from './editorExtensions'
import { EditorToolbar } from './EditorToolbar'
import { FormulaDialog } from './FormulaDialog'
import { MenuBar } from '../layout/MenuBar'
import { useFormulaStore } from '../../stores/formulaStore'

vi.mock('../../hooks/useFileSystem', () => ({
  useFileSystem: () => ({
    openWorkspace: vi.fn(), openRecent: vi.fn(), saveFile: vi.fn(), saveAll: vi.fn(),
    openFile: vi.fn(), createNewFile: vi.fn(), createProject: vi.fn(), refreshTree: vi.fn(),
  }),
  isTauri: () => false,
}))
vi.mock('../../hooks/usePrint', () => ({ usePrint: () => vi.fn() }))

let root: Root | null = null
let editor: Editor | null = null
let container: HTMLDivElement | null = null
const markdownOf = (value: Editor) => (value.storage as unknown as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown()

beforeAll(() => Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true))

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) { this.setAttribute('open', '') }),
  })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) { this.removeAttribute('open') }),
  })
  useFormulaStore.getState().hide()
  container = document.createElement('div')
  document.body.append(container)
})

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = null
  editor?.destroy()
  editor = null
  container?.remove()
  container = null
  useFormulaStore.getState().hide()
})

describe('Insert Formula (toolbar, Insert menu, KaTeX rendering, and Markdown round-trip)', () => {
  it('places Insert Formula immediately to the right of 1. List in the toolbar and opens the formula builder', async () => {
    editor = new Editor({ extensions: EDITOR_EXTENSIONS, content: '<p>Theorem:</p>', editorProps: { handleScrollToSelection: () => true } })
    root = createRoot(container!)
    await act(async () => root?.render(<><EditorToolbar editor={editor} /><FormulaDialog /></>))

    const ordered = container!.querySelector<HTMLButtonElement>('[aria-label="Numbered list"]')!
    const nextButton = ordered.nextElementSibling as HTMLButtonElement | null
    expect(nextButton).not.toBeNull()
    expect(nextButton?.getAttribute('aria-label')).toBe('Insert Formula')
    expect(nextButton?.textContent).toBe('∑ Formula')

    await act(async () => nextButton!.click())
    expect(useFormulaStore.getState().open).toBe(true)
    expect(container!.querySelector('#insert-formula-title')?.textContent).toBe('Insert Formula')
  })

  it('opens the formula dialog from Insert > Insert Formula in the application menu', async () => {
    editor = new Editor({ extensions: EDITOR_EXTENSIONS, content: '<p>Proof:</p>', editorProps: { handleScrollToSelection: () => true } })
    root = createRoot(container!)
    const panels = { files: true, templates: true, snippets: true, git: true, properties: true }
    await act(async () => root?.render(<><MenuBar visiblePanels={panels} onTogglePanel={() => {}} editor={editor} /><FormulaDialog /></>))

    const insertMenu = Array.from(container!.querySelectorAll('nav > details')).find((d) => d.querySelector('summary')?.textContent === 'Insert')!
    const button = Array.from(insertMenu.querySelectorAll('button')).find((b) => b.textContent === 'Insert Formula')!
    expect(button.disabled).toBe(false)

    await act(async () => button.click())
    expect(useFormulaStore.getState().open).toBe(true)
    expect(container!.querySelector('#insert-formula-title')?.textContent).toBe('Insert Formula')
  })

  it('inserts complex formulas with presets, symbols, live KaTeX preview, and round-trips through Markdown', async () => {
    const host = document.createElement('div')
    container!.append(host)
    editor = new Editor({ element: host, extensions: EDITOR_EXTENSIONS, content: '<p>Result:</p>', editorProps: { handleScrollToSelection: () => true } })
    editor.commands.setTextSelection(8)
    root = createRoot(container!)
    await act(async () => root?.render(<><EditorToolbar editor={editor} /><FormulaDialog /></>))

    await act(async () => useFormulaStore.getState().show(editor!, { latex: '', display: 'block' }))
    const integralPreset = Array.from(container!.querySelectorAll('button')).find((b) => b.textContent === 'Integral')!
    await act(async () => integralPreset.click())

    const preview = container!.querySelector('[aria-label="Formula preview"]')!
    expect(preview.querySelector('.katex')).not.toBeNull()

    const submit = Array.from(container!.querySelectorAll('footer button')).find((b) => b.textContent === 'Insert Formula') as HTMLButtonElement
    expect(submit.disabled).toBe(false)
    await act(async () => submit.click())

    expect(useFormulaStore.getState().open).toBe(false)
    const formulaDom = host.querySelector<HTMLElement>('.grimoire-formula')
    expect(formulaDom).not.toBeNull()
    expect(formulaDom?.getAttribute('data-latex')).toBe('\\int_{a}^{b} f(x)\\,dx')
    expect(formulaDom?.getAttribute('data-display')).toBe('block')
    expect(formulaDom?.querySelector('.katex')).not.toBeNull()

    const saved = markdownOf(editor)
    expect(saved).toContain('<span data-type="math-formula" data-latex="\\int_{a}^{b} f(x)\\,dx" data-display="block"></span>')

    const reloaded = new Editor({ extensions: EDITOR_EXTENSIONS, content: saved })
    try {
      expect(reloaded.getJSON()).toEqual(editor.getJSON())
    } finally {
      reloaded.destroy()
    }
  })

  it('edits an existing formula in place when double-clicked', async () => {
    const host = document.createElement('div')
    container!.append(host)
    editor = new Editor({
      element: host,
      extensions: EDITOR_EXTENSIONS,
      content: '<p><span data-type="math-formula" data-latex="a^2 + b^2 = c^2" data-display="inline"></span></p>',
      editorProps: { handleScrollToSelection: () => true },
    })
    root = createRoot(container!)
    await act(async () => root?.render(<FormulaDialog />))

    const node = host.querySelector<HTMLElement>('.grimoire-formula')!
    await act(async () => { node.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })
    expect(useFormulaStore.getState().open).toBe(true)
    expect(container!.querySelector('#insert-formula-title')?.textContent).toBe('Edit Formula')

    const textarea = container!.querySelector<HTMLTextAreaElement>('textarea[aria-label="LaTeX Expression"]')!
    expect(textarea.value).toBe('a^2 + b^2 = c^2')
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    await act(async () => {
      setValue.call(textarea, 'E = mc^2')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })

    const updateBtn = Array.from(container!.querySelectorAll('footer button')).find((b) => b.textContent === 'Update Formula') as HTMLButtonElement
    await act(async () => updateBtn.click())

    expect(host.querySelector('.grimoire-formula')?.getAttribute('data-latex')).toBe('E = mc^2')
    expect(markdownOf(editor)).toContain('data-latex="E = mc^2"')
  })
})
