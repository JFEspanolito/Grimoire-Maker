import { Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { afterEach, expect, it, vi } from 'vitest'
import { findSnippetDropTarget, registerSnippetDropTarget } from './snippetDrop'

afterEach(() => { vi.restoreAllMocks(); Reflect.deleteProperty(document, 'elementFromPoint'); document.body.replaceChildren() })

it('resolves the editor under the drop, inserts at that point, and unregisters closed views', () => {
  const pages = [0, 1].map(() => {
    const page = document.createElement('div')
    page.className = 'grimoire-page'
    const host = document.createElement('div')
    page.append(host)
    document.body.append(page)
    return new Editor({ element: host, extensions: [StarterKit], content: '<p>First</p><p>Last</p>',
      editorProps: { handleScrollToSelection: () => true } })
  })
  const unregister = pages.map((page) => registerSnippetDropTarget(page))
  try {
    const target = pages[1]
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => target.view.dom) })
    vi.spyOn(target.view.dom, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 500, bottom: 500, width: 500, height: 500 } as DOMRect)
    vi.spyOn(target.view, 'posAtCoords').mockReturnValue({ pos: 7, inside: -1 })
    target.commands.setTextSelection(1)
    const drop = findSnippetDropTarget(200, 200)
    expect(drop?.editor).toBe(target)
    expect(drop?.position).toBe(7)
    drop!.editor.commands.insertContentAt(drop!.position, '<p>Snippet</p>')
    expect(target.getHTML()).toBe('<p>First</p><p>Snippet</p><p>Last</p>')
    expect(pages[0].getHTML()).toBe('<p>First</p><p>Last</p>')
    unregister[1]()
    expect(findSnippetDropTarget(200, 200)).toBeNull()
    vi.mocked(document.elementFromPoint).mockReturnValue(document.body)
    expect(findSnippetDropTarget(200, 200)).toBeNull()
  } finally { unregister.forEach((dispose) => dispose()); pages.forEach((editor) => editor.destroy()) }
})
