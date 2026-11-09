import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { TableControls, findTable, toggleColumnSpan, setTableColumnWidth } from './TableControls'
import { TableExtensions } from './extensions/tables'

let root: Root | null = null
let editor: Editor | null = null
beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  }
  if (!Element.prototype.getClientRects) {
    Element.prototype.getClientRects = () => [] as unknown as DOMRectList
  }
})

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = null
  editor?.destroy()
  editor = null
})

describe('TableControls', () => {
  function mountTableEditor(content: string) {
    const host = document.createElement('div')
    document.body.append(host)
    editor = new Editor({
      element: host,
      extensions: [StarterKit, ...TableExtensions],
      content,
      editorProps: { handleScrollToSelection: () => true },
    })
    const container = document.createElement('div')
    root = createRoot(container)
    return { container, editor }
  }

  it('toggles columnSpan between all and null', async () => {
    const source = '<table><thead><tr><th>Header 1</th><th>Header 2</th></tr></thead><tbody><tr><td>Cell 1</td><td>Cell 2</td></tr></tbody></table>'
    const { container, editor } = mountTableEditor(source)
    editor.commands.setTextSelection(3) // Inside Header 1

    await act(async () => root?.render(<TableControls editor={editor} />))

    const spanButton = container.querySelector<HTMLButtonElement>('[aria-label="Span all columns (full page width)"]')
    expect(spanButton).not.toBeNull()
    expect(spanButton!.getAttribute('aria-pressed')).toBe('false')

    await act(async () => spanButton!.click())
    const table = findTable(editor)
    expect(table?.node.attrs.columnSpan).toBe('all')
    expect(spanButton!.getAttribute('aria-pressed')).toBe('true')

    await act(async () => spanButton!.click())
    const tableAfter = findTable(editor)
    expect(tableAfter?.node.attrs.columnSpan).toBeNull()
    expect(spanButton!.getAttribute('aria-pressed')).toBe('false')
  })

  it('adjusts individual column width and resets it', async () => {
    const source = '<table><thead><tr><th>Header 1</th><th>Header 2</th></tr></thead><tbody><tr><td>Cell 1</td><td>Cell 2</td></tr></tbody></table>'
    const { container, editor } = mountTableEditor(source)
    editor.commands.setTextSelection(3) // Inside Header 1

    await act(async () => root?.render(<TableControls editor={editor} />))

    const widthInput = container.querySelector<HTMLInputElement>('input[type="number"]')
    expect(widthInput).not.toBeNull()
    expect(widthInput!.value).toBe('')

    await act(async () => {
      setTableColumnWidth(editor, 180)
    })

    const firstCell = editor.state.doc.firstChild?.firstChild?.firstChild
    expect(firstCell?.attrs.colwidth).toEqual([180])

    const autoButton = container.querySelector<HTMLButtonElement>('[aria-label="Reset column width to auto"]')
    expect(autoButton).not.toBeNull()
    await act(async () => autoButton!.click())

    const resetCell = editor.state.doc.firstChild?.firstChild?.firstChild
    expect(resetCell?.attrs.colwidth).toBeNull()
  })
})
