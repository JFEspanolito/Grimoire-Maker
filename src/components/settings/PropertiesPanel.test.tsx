import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Editor } from '@tiptap/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EDITOR_EXTENSIONS } from '../editor/editorExtensions'
import { PropertiesPanel } from './PropertiesPanel'
import { useDocumentStore } from '../../stores/documentStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useProjectStore } from '../../stores/projectStore'
import { useTabStore } from '../../stores/tabStore'
import { useLayoutStore } from '../../stores/layoutStore'
import { loadProjectSettings, saveProjectSettings } from '../../lib/projectSettings'
vi.mock('../../lib/projectSettings', () => ({
  EMPTY_PROJECT: { name: '', author: '', coAuthor: '' },
  loadProjectSettings: vi.fn(), saveProjectSettings: vi.fn(),
}))
let root: Root
let host: HTMLDivElement
beforeEach(async () => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  vi.clearAllMocks()
  HTMLDialogElement.prototype.showModal = function () { this.open = true }
  HTMLDialogElement.prototype.close = function () { this.open = false }
  useProjectStore.setState({ entries: {} })
  useDocumentStore.getState().setWorkspace('/book', [])
  useDocumentStore.getState().loadFromRaw('/book/a.md', 'A')
  useTabStore.getState().reset('/book/a.md')
  useSettingsStore.setState({ columns: 2 })
  vi.mocked(loadProjectSettings).mockResolvedValue({ name: 'Book', author: 'Alice', coAuthor: '' })
  vi.mocked(saveProjectSettings).mockResolvedValue(undefined)
  host = document.createElement('div'); root = createRoot(host)
  await act(async () => root.render(<PropertiesPanel />))
})
afterEach(async () => { await act(async () => root.unmount()); useDocumentStore.getState().resetDocuments(); useDocumentStore.getState().setWorkspace(null, []) })
async function input(label: string, value: string) {
  const field = host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
it('starts project and page properties collapsed', () => {
  const sections = Array.from(host.querySelectorAll('details'))
  expect(sections.map(section => section.querySelector('summary')?.textContent)).toEqual(['Project properties', 'Page properties'])
  expect(sections.every(section => !section.open)).toBe(true)
})
it('saves Author at project scope, not in page frontmatter', async () => {
  await input('Author', 'Jane')
  await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(saveProjectSettings).toHaveBeenCalledWith('/book', { name: 'Book', author: 'Jane', coAuthor: '' })
  expect(useDocumentStore.getState().document.frontmatter.author).toBeUndefined()
  expect(host.textContent).toContain('Project settings saved.')
})
it('persists columns in the selected Markdown without changing its sibling or the default', async () => {
  const select = host.querySelector<HTMLSelectElement>('[aria-label="Page columns"]')!
  await act(async () => { select.value = '1'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  expect(useDocumentStore.getState().toRaw()).toContain('columns: 1')
  expect(useDocumentStore.getState().document.dirty).toBe(true)
  await act(async () => {
    useDocumentStore.getState().loadFromRaw('/book/b.md', 'B')
    useTabStore.getState().reset('/book/b.md')
  })
  expect(select.value).toBe('')
  expect(useDocumentStore.getState().buffers['/book/a.md'].frontmatter.columns).toBe(1)
  expect(useSettingsStore.getState().columns).toBe(2)
})
it('does not offer page controls for binary files', async () => {
  await act(async () => useTabStore.getState().reset('/book/image.png'))
  expect(host.querySelector('[aria-label="Page columns"]')).toBeNull()
  expect(host.querySelector('[aria-label="Author"]')).not.toBeNull()
})
it('never displays one project credits after switching to another', async () => {
  let finish!: (value: { name: string; author: string; coAuthor: string }) => void
  vi.mocked(loadProjectSettings).mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
  await act(async () => useDocumentStore.getState().setWorkspace('/other', []))
  expect(host.querySelector<HTMLInputElement>('[aria-label="Author"]')!.value).toBe('')
  expect(host.querySelector<HTMLInputElement>('[aria-label="Author"]')!.disabled).toBe(true)
  await act(async () => finish({ name: 'Other', author: 'Bob', coAuthor: '' }))
  expect(host.querySelector<HTMLInputElement>('[aria-label="Author"]')!.value).toBe('Bob')
})

it('saves changed project fields on blur and retains the explicit Save button', async () => {
  const field = host.querySelector<HTMLInputElement>('[aria-label="Author"]')!
  await act(async () => field.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
  expect(saveProjectSettings).not.toHaveBeenCalled()
  await input('Author', 'New author')
  await act(async () => field.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
  expect(saveProjectSettings).toHaveBeenCalledExactlyOnceWith('/book', { name: 'Book', author: 'New author', coAuthor: '' })
  expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.textContent).toBe('Save project settings')
})
it('does not duplicate an in-flight blur save and retains edits after a failed save for retry', async () => {
  let reject!: (error: Error) => void
  vi.mocked(saveProjectSettings).mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail }))
  await input('Author', 'Second author')
  const field = host.querySelector<HTMLInputElement>('[aria-label="Author"]')!
  await act(async () => field.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
  expect(saveProjectSettings).toHaveBeenCalledTimes(1)
  await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(saveProjectSettings).toHaveBeenCalledTimes(1)
  await act(async () => reject(new Error('Disk unavailable')))
  expect(field.value).toBe('Second author')
  expect(host.querySelector('[role="alert"]')!.textContent).toContain('Disk unavailable')
  await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(saveProjectSettings).toHaveBeenCalledTimes(2)
  expect(host.textContent).toContain('Project settings saved.')
})
it('opens collapsed property groups and collapses each independently without discarding fields', async () => {
  const groups = host.querySelectorAll('details')
  expect(groups).toHaveLength(2)
  expect(groups[0].open).toBe(false)
  expect(groups[1].open).toBe(false)
  await act(async () => groups[0].querySelector('summary')!.click())
  await act(async () => groups[1].querySelector('summary')!.click())
  expect(groups[0].open).toBe(true)
  expect(groups[1].open).toBe(true)
  await input('Author', 'Draft author')
  await act(async () => groups[0].querySelector('summary')!.click())
  expect(groups[0].open).toBe(false)
  expect(groups[1].open).toBe(true)
  await act(async () => groups[0].querySelector('summary')!.click())
  expect(host.querySelector<HTMLInputElement>('[aria-label="Author"]')!.value).toBe('Draft author')
  await act(async () => groups[1].querySelector('summary')!.click())
  expect(groups[1].open).toBe(false)
  expect(groups[0].open).toBe(true)
})

it('edits the shared book metadata without changing the project folder', async () => {
  await input('Book name', 'Project title')
  await act(async () => host.querySelector('[aria-label="Book name"]')!.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
  expect(useProjectStore.getState().entries['/book'].settings.name).toBe('Project title')
  expect(useDocumentStore.getState().workspaceRoot).toBe('/book')
  expect(host.querySelector('[aria-label="Author"]')).not.toBeNull()
  expect(host.querySelector('[aria-label="Co-Author"]')).not.toBeNull()
})

it('opens Artist as a link-style action and saves a contributor list', async () => {
  expect(host.querySelector('input[aria-label="Co-Author"]')).toBeNull()
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Artist"]')!.click())
  const modal = document.querySelector('dialog')!
  expect(modal.open).toBe(true)
  expect(modal.querySelector('button[type="submit"]')!.textContent).toBe('Save')
  expect(modal.querySelector('[aria-label="Add artist"]')!.textContent).toBe('Add artist')
  await act(async () => modal.querySelector<HTMLButtonElement>('[aria-label="Add artist"]')!.click())
  for (const [label, value] of [['Name 1', 'Midrava'], ['Social media 1', '@midrava'], ['Platform 1', 'Instagram']]) {
    const field = modal.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value)
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  await act(async () => modal.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(saveProjectSettings).toHaveBeenLastCalledWith('/book', expect.objectContaining({ artists: [{ name: 'Midrava', socialMedia: '@midrava', platform: 'Instagram' }] }))
  expect(document.querySelector('dialog')).toBeNull()
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Artist"]')!.click())
  expect(document.querySelector<HTMLInputElement>('[aria-label="Name 1"]')!.value).toBe('Midrava')
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Cancel contributors"]')!.click())
})

it('keeps existing co-author text as an editable entry and supports clearing the list without erasing artists', async () => {
  const artists = [{ name: 'Midrava', socialMedia: '@midrava', platform: 'Instagram' }]
  await act(async () => useProjectStore.setState({ entries: { '/book': { ready: true, busy: false, error: '', settings: { name: 'Book', author: 'Alice', coAuthor: 'Legacy Writer', artists } } } }))
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Co-Author"]')!.click())
  expect(document.querySelector<HTMLInputElement>('[aria-label="Name 1"]')!.value).toBe('Legacy Writer')
  expect(document.querySelector('[aria-label="Add co-author"]')!.textContent).toBe('Add co-author')
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Remove contributor 1"]')!.click())
  await act(async () => document.querySelector('dialog form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(saveProjectSettings).toHaveBeenLastCalledWith('/book', expect.objectContaining({ coAuthors: [], artists, coAuthor: 'Legacy Writer' }))
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Co-Author"]')!.click())
  expect(document.querySelector('[aria-label="Name 1"]')).toBeNull()
  await act(async () => document.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true })))
  expect(document.querySelector('dialog')).toBeNull()
})

it('cancels list edits without writing and retains failed saves for retry', async () => {
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Artist"]')!.click())
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Add artist"]')!.click())
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Cancel contributors"]')!.click())
  expect(saveProjectSettings).not.toHaveBeenCalled()
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Artist"]')!.click())
  expect(document.querySelector('[aria-label="Name 1"]')).toBeNull()
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Add artist"]')!.click())
  const field = document.querySelector<HTMLInputElement>('[aria-label="Name 1"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, 'Artist One')
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
  vi.mocked(saveProjectSettings).mockRejectedValueOnce(new Error('Disk unavailable'))
  await act(async () => document.querySelector('dialog form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(document.querySelector('dialog [role="alert"]')!.textContent).toContain('Disk unavailable')
  expect(field.value).toBe('Artist One')
  await act(async () => document.querySelector('dialog form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(document.querySelector('dialog')).toBeNull()
})

describe('page columns', () => {
  /** Two sheets stacked in the page; each paragraph's boxes tell which sheet it is on. */
  function layOut(editor: Editor, sheetOfBlock: number[]) {
    const stack = document.createElement('div')
    stack.dataset.editorStack = ''
    document.body.append(stack)
    const sheets = [1, 2].map((number) => {
      const sheet = document.createElement('div')
      sheet.dataset.editorSheet = String(number)
      vi.spyOn(sheet, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 100, top: (number - 1) * 120, bottom: (number - 1) * 120 + 100, width: 100, height: 100 } as DOMRect)
      stack.append(sheet)
      return sheet
    })
    stack.append(editor.view.dom)
    layBlocks(editor, sheetOfBlock)
    return { stack, sheets }
  }
  /** Re-applied after an edit, because ProseMirror may redraw a block's element. */
  function layBlocks(editor: Editor, sheetOfBlock: number[]) {
    let block = 0
    editor.state.doc.forEach((section, sectionOffset) => section.forEach((_node, offset) => {
      const dom = editor.view.nodeDOM(sectionOffset + 1 + offset) as HTMLElement
      const top = (sheetOfBlock[block++] - 1) * 120 + 10
      vi.spyOn(dom, 'getClientRects').mockReturnValue([{ left: 5, right: 95, top, bottom: top + 20, width: 90, height: 20 }] as unknown as DOMRectList)
    }))
  }

  it('isolates the caret page in its own section, restores the pages after it and tidies up again', async () => {
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
    const editor = new Editor({ extensions: EDITOR_EXTENSIONS, content: 'One\n\nTwo\n\nThree' })
    const { stack } = layOut(editor, [1, 2, 2])
    editor.commands.setTextSelection(editor.state.doc.firstChild!.child(0).nodeSize + 3)
    vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue({ left: 10, right: 11, top: 130, bottom: 145 })
    useLayoutStore.getState().setSheets('__untitled__', 2)
    const container = document.createElement('div')
    const root = createRoot(container)
    const choose = (value: string) => act(async () => {
      const select = container.querySelector<HTMLSelectElement>('[aria-label="This page columns"]')!
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, value)
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    try {
      await act(async () => root.render(<PropertiesPanel expanded editor={editor} />))
      expect(container.querySelector('label:has([aria-label="This page columns"])')!.textContent).toContain('(2 of 2)')
      await choose('1')
      // Page 1 keeps the file default; page 2 alone is one column; nothing follows it here.
      expect(editor.state.doc.childCount).toBe(2)
      expect(editor.state.doc.child(0).attrs).toMatchObject({ columns: null })
      expect(editor.state.doc.child(1).attrs).toMatchObject({ columns: 1, auto: true })
      expect(editor.state.doc.child(0).textContent).toBe('One')
      layBlocks(editor, [1, 2, 2])
      await choose('')
      // The generated section no longer differs, so it merges back into the first.
      expect(editor.state.doc.childCount).toBe(1)
      expect(editor.state.doc.textContent).toBe('OneTwoThree')
    } finally { await act(async () => root.unmount()); stack.remove(); editor.destroy() }
  })

  it('splits before and after a middle page so its neighbours keep their columns', () => {
    const editor = new Editor({ extensions: EDITOR_EXTENSIONS, content: 'One\n\nTwo\n\nThree' })
    const section = editor.state.doc.firstChild!
    const start = 1 + section.child(0).nodeSize
    const next = start + section.child(1).nodeSize
    editor.commands.setPageColumns({ start, next, columns: 1 })
    expect(editor.state.doc.children.map(node => [node.textContent, node.attrs.columns, node.attrs.auto])).toEqual([
      ['One', null, false], ['Two', 1, true], ['Three', null, true],
    ])
    // Setting the middle page back removes both generated markers.
    const middle = editor.state.doc.child(0).nodeSize + 1
    editor.commands.setPageColumns({ start: middle, next: middle + editor.state.doc.child(1).nodeSize, columns: null })
    expect(editor.state.doc.childCount).toBe(1)
    editor.destroy()
  })
})
