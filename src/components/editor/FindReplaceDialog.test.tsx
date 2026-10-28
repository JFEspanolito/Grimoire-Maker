import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Editor } from '@tiptap/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { EDITOR_EXTENSIONS } from './editorExtensions'
import { EditorToolbar } from './EditorToolbar'
import { FindReplaceDialog } from './FindReplaceDialog'
import { useDocumentStore } from '../../stores/documentStore'
import { useFindStore } from '../../stores/findStore'
import { useTabStore } from '../../stores/tabStore'

const openFile = vi.hoisted(() => vi.fn())
const snapshotProjectTexts = vi.hoisted(() => vi.fn())
const commitProjectReplace = vi.hoisted(() => vi.fn())
const autoCommitChanges = vi.hoisted(() => vi.fn())
vi.mock('../../hooks/useFileSystem', () => ({ useFileSystem: () => ({ openFile }), isTauri: () => false }))
vi.mock('../../lib/projectReplace', () => ({ snapshotProjectTexts, commitProjectReplace }))
vi.mock('../../lib/versionControl', () => ({ autoCommitChanges }))

let editor: Editor | null = null
const showModal = vi.fn()
beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: showModal })
  // jsdom has no layout; ProseMirror asks for rectangles when it scrolls a selection into view.
  for (const proto of [Range.prototype, Element.prototype, Text.prototype]) {
    Object.defineProperty(proto, 'getClientRects', { configurable: true, value: () => [] })
    Object.defineProperty(proto, 'getBoundingClientRect', { configurable: true, value: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }) })
  }
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: vi.fn() })
})
beforeEach(() => {
  useFindStore.setState({ open: false, scope: 'file', term: '', replacement: '', caseSensitive: false, wholeWord: false, regex: false, replaceOpen: true, lastReplace: null })
  showModal.mockClear()
  openFile.mockReset()
  snapshotProjectTexts.mockReset()
  commitProjectReplace.mockReset()
  autoCommitChanges.mockReset()
})
afterEach(() => {
  editor?.destroy()
  editor = null
  vi.useRealTimers()
  document.body.innerHTML = ''
})

async function open(content: string) {
  editor = new Editor({ extensions: EDITOR_EXTENSIONS, content })
  document.body.append(editor.view.dom)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const render = (current: Editor | null) => act(async () => root.render(<><EditorToolbar editor={current} /><FindReplaceDialog editor={current} /></>))
  await render(editor)
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Find and Replace (Ctrl+F)"]')!.click())
  const inputs = () => container.querySelectorAll<HTMLInputElement>('dialog input:not([type])')
  const set = (input: HTMLInputElement, value: string) => act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const buttons = () => Array.from(container.querySelectorAll<HTMLButtonElement>('dialog button'))
  const click = (label: string) => act(async () => buttons().find((button) => button.textContent === label)!.click())
  const status = () => container.querySelector('dialog [role="status"]')!.textContent
  return { container, render, find: inputs()[0], replace: inputs()[1], set, click, buttons, status, unmount: () => act(async () => root.unmount()) }
}
const text = () => editor!.getText().trim()

it('counts matches, highlights them and steps through them', async () => {
  const { container, find, set, click, unmount } = await open('Dragon and dragon and DRAGON')
  await set(find, 'dragon')
  expect(container.querySelector('dialog [role="status"]')!.textContent).toBe('3 matches')
  expect(editor!.view.dom.querySelectorAll('.search-match')).toHaveLength(3)
  await click('Next')
  expect(editor!.state.doc.textBetween(editor!.state.selection.from, editor!.state.selection.to)).toBe('Dragon')
  expect(container.querySelector('dialog [role="status"]')!.textContent).toBe('1 of 3')
  await click('Next')
  expect(editor!.state.selection.from).toBeGreaterThan(1)
  await unmount()
})

it('replaces the current match, all matches, and respects Match case', async () => {
  const { container, find, replace, set, click, unmount } = await open('cat Cat cat')
  await set(find, 'cat')
  await set(replace, 'dog')
  await click('Replace All')
  expect(text()).toBe('dog dog dog')
  editor!.commands.setContent('cat Cat cat')
  await act(async () => container.querySelector<HTMLInputElement>('dialog input[type="checkbox"]')!.click())
  expect(container.querySelector('dialog [role="status"]')!.textContent).toBe('2 matches')
  await click('Next')
  await click('Replace')
  expect(text()).toBe('dog Cat cat')
  await unmount()
})

describe('floating panel', () => {
  it('is not modal: no showModal, no backdrop, no aria-modal, and typing elsewhere still works', async () => {
    const { container, unmount } = await open('Some page')
    const panel = container.querySelector('dialog')!
    expect(showModal).not.toHaveBeenCalled()
    expect(panel.hasAttribute('open')).toBe(true)
    expect(panel.hasAttribute('aria-modal')).toBe(false)
    expect(container.querySelector('[class*="backdrop"]')).toBeNull()
    const outside = document.createElement('textarea')
    document.body.append(outside)
    outside.focus()
    outside.value = 'still typing'
    outside.dispatchEvent(new Event('input', { bubbles: true }))
    expect(document.activeElement).toBe(outside)
    expect(outside.value).toBe('still typing')
    expect(panel.querySelector('[inert]')).toBeNull()
    await unmount()
  })

  it('keeps counting while the page changes', async () => {
    const { find, set, status, unmount } = await open('dragon')
    vi.useFakeTimers()
    await set(find, 'dragon')
    expect(status()).toBe('1 match')
    await act(async () => { editor!.commands.insertContentAt(editor!.state.doc.content.size - 1, ' dragon') })
    expect(status()).toBe('1 match')
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    expect(status()).toBe('2 matches')
    await unmount()
  })

  it('closes with Esc from inside and sends focus back to the editor', async () => {
    const { container, find, unmount } = await open('Some page')
    const focus = vi.spyOn(editor!.view, 'focus')
    await act(async () => { find.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 60)) })
    expect(container.querySelector('dialog')).toBeNull()
    expect(useFindStore.getState().open).toBe(false)
    expect(focus).toHaveBeenCalled()
    await unmount()
  })

  it('remembers the last term and options after closing', async () => {
    const { find, set, click, container, unmount } = await open('Some page')
    await set(find, 'page')
    await click('×')
    expect(container.querySelector('dialog')).toBeNull()
    await act(async () => useFindStore.getState().show())
    expect(container.querySelector<HTMLInputElement>('dialog input:not([type])')!.value).toBe('page')
    await unmount()
  })

  it('finds whole words and regular expressions, and expands $1 only in regex mode', async () => {
    const { container, find, replace, set, click, status, unmount } = await open('cat concat cat')
    await set(find, 'cat')
    await act(async () => container.querySelectorAll<HTMLInputElement>('dialog input[type="checkbox"]')[1].click())
    expect(status()).toBe('2 matches')
    await act(async () => container.querySelectorAll<HTMLInputElement>('dialog input[type="checkbox"]')[1].click())
    await act(async () => container.querySelectorAll<HTMLInputElement>('dialog input[type="checkbox"]')[2].click())
    await set(find, '(c)at')
    await set(replace, '$1-dog')
    await click('Replace All')
    expect(text()).toBe('c-dog conc-dog c-dog')
    await set(find, '(')
    expect(container.querySelector('dialog [role="alert"]')!.textContent).toMatch(/not valid/)
    await unmount()
  })

  it('replaces literally in plain mode', async () => {
    const { find, replace, set, click, unmount } = await open('a a')
    await set(find, 'a')
    await set(replace, '$&$1')
    await click('Replace All')
    expect(text()).toBe('$&$1 $&$1')
    await unmount()
  })
})

describe('Project scope', () => {
  const tree = [
    { name: 'Draft', path: '/p/Draft', isDirectory: true, children: [
      { name: 'a.md', path: '/p/Draft/a.md', isDirectory: false },
      { name: 'b.md', path: '/p/Draft/b.md', isDirectory: false },
    ] },
    { name: 'Trash', path: '/p/Trash', isDirectory: true, children: [{ name: 'c.md', path: '/p/Trash/c.md', isDirectory: false }] },
  ]
  const rawA = '---\r\ntitle:   A\r\n---\r\nThe dragon [dragon](dragon.md)\r\n'
  const disk = [
    { path: '/p/Draft/a.md', before: rawA },
    { path: '/p/Draft/b.md', before: 'disk dragon\n' },
    { path: '/p/Trash/c.md', before: 'trash dragon\n' },
  ]

  async function project(term = 'dragon') {
    useDocumentStore.setState({
      workspaceRoot: '/p', tree,
      document: { path: '/p/Draft/b.md', frontmatter: {}, body: 'buffer dragon', dirty: false },
      buffers: { '/p/Draft/b.md': { path: '/p/Draft/b.md', frontmatter: {}, body: 'buffer dragon', dirty: false } },
    })
    useTabStore.getState().reset('/p/Draft/b.md')
    snapshotProjectTexts.mockResolvedValue(disk)
    commitProjectReplace.mockResolvedValue([])
    autoCommitChanges.mockResolvedValue('committed')
    const view = await open('buffer dragon')
    vi.useFakeTimers()
    await act(async () => useFindStore.getState().set({ scope: 'project' }))
    await view.set(view.find, term)
    await settle()
    return view
  }
  const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(300) })

  it('lists matches by file from buffers first and disk second, skipping Trash and masked links', async () => {
    const { container, status, unmount } = await project()
    expect(status()).toBe('3 matches in 2 files')
    const headings = Array.from(container.querySelectorAll('h3 span')).map((item) => item.textContent)
    expect(headings).toEqual(['Draft/a.md', 'Draft/b.md'])
    const hits = Array.from(container.querySelectorAll('dialog li > button:first-of-type')).map((item) => item.textContent)
    expect(hits).toEqual(['1The dragon [dragon](dragon.md)', '1The dragon [dragon](dragon.md)', '1buffer dragon'])
    expect(container.textContent).not.toContain('trash dragon')
    await unmount()
  })

  it('replaces one match in a closed file, keeping the frontmatter bytes and passing the known paths', async () => {
    const { container, replace, set, unmount } = await project()
    await set(replace, 'wyrm')
    await act(async () => container.querySelectorAll<HTMLButtonElement>('section')[0].querySelector<HTMLButtonElement>('li > button:last-child')!.click())
    expect(commitProjectReplace).toHaveBeenCalledWith('/p', [
      { path: '/p/Draft/a.md', before: rawA, after: '---\r\ntitle:   A\r\n---\r\nThe wyrm [dragon](dragon.md)\r\n' },
    ], ['/p/Draft/a.md', '/p/Draft/b.md', '/p/Trash/c.md'])
    await unmount()
  })

  it('replaces in an open document through the buffer store (dirty) and does not touch disk', async () => {
    const { container, replace, set, unmount } = await project()
    await set(replace, 'wyrm')
    await act(async () => container.querySelectorAll<HTMLButtonElement>('section')[1].querySelector<HTMLButtonElement>('li > button:last-child')!.click())
    expect(commitProjectReplace).not.toHaveBeenCalled()
    const buffer = useDocumentStore.getState().buffers['/p/Draft/b.md']
    expect(buffer.body).toBe('buffer wyrm')
    expect(buffer.dirty).toBe(true)
    await unmount()
  })

  it('replaces every match of a file, keeping the link destination', async () => {
    const { container, replace, set, unmount } = await project()
    await set(replace, 'wyrm')
    await act(async () => container.querySelectorAll<HTMLButtonElement>('section')[0].querySelector<HTMLButtonElement>('h3 button')!.click())
    const [, changes] = commitProjectReplace.mock.calls[0]
    expect(changes[0].after).toBe('---\r\ntitle:   A\r\n---\r\nThe wyrm [wyrm](dragon.md)\r\n')
    await unmount()
  })

  it('asks for confirmation, commits first, replaces everywhere and offers Undo last replace', async () => {
    const { container, replace, set, click, buttons, unmount } = await project()
    await set(replace, 'wyrm')
    expect(buttons().find((b) => b.textContent?.startsWith('Replace All'))!.textContent).toBe('Replace All (3 matches in 2 files)')
    await act(async () => buttons().find((b) => b.textContent?.startsWith('Replace All'))!.click())
    expect(autoCommitChanges).toHaveBeenCalledWith('/p', 'Before replace all')
    expect(container.querySelector('[aria-label="Confirm replace all"]')!.textContent).toContain('Before replace all')
    expect(commitProjectReplace).not.toHaveBeenCalled()
    await click('Yes, replace all')
    expect(commitProjectReplace).toHaveBeenCalledTimes(1)
    expect(useDocumentStore.getState().buffers['/p/Draft/b.md'].body).toBe('buffer wyrm')
    expect(useFindStore.getState().lastReplace).toHaveLength(2)

    // Undo: closed files go back through a swapped commit with fresh known paths, open buffers if unchanged.
    commitProjectReplace.mockClear()
    await click('Undo last replace')
    const [, swapped, known] = commitProjectReplace.mock.calls[0]
    expect(swapped[0].before).toContain('The wyrm [wyrm](dragon.md)')
    expect(swapped[0].after).toBe(rawA)
    expect(known).toEqual(['/p/Draft/a.md', '/p/Draft/b.md', '/p/Trash/c.md'])
    expect(useDocumentStore.getState().buffers['/p/Draft/b.md'].body).toBe('buffer dragon')
    await unmount()
  })

  it('skips an open document that changed since the replace when undoing, and says so', async () => {
    const { container, replace, set, click, buttons, unmount } = await project()
    await set(replace, 'wyrm')
    await act(async () => buttons().find((b) => b.textContent?.startsWith('Replace All'))!.click())
    await click('Yes, replace all')
    act(() => useDocumentStore.getState().setBodyForPath('/p/Draft/b.md', 'buffer wyrm and more typing'))
    await click('Undo last replace')
    expect(useDocumentStore.getState().buffers['/p/Draft/b.md'].body).toBe('buffer wyrm and more typing')
    expect(container.textContent).toContain('Skipped because they changed since: Draft/b.md')
    await unmount()
  })

  it('warns when there is no repository to recover from', async () => {
    const { container, buttons, unmount } = await project()
    autoCommitChanges.mockResolvedValue('noRepository')
    await act(async () => buttons().find((b) => b.textContent?.startsWith('Replace All'))!.click())
    expect(container.querySelector('[aria-label="Confirm replace all"]')!.textContent).toContain('cannot be recovered with version control')
    autoCommitChanges.mockResolvedValue('gitUnavailable')
    await unmount()
  })

  it('shows a plain message and searches again when the commit is rejected', async () => {
    const { container, buttons, click, unmount } = await project()
    commitProjectReplace.mockRejectedValue(new Error('changed'))
    await act(async () => buttons().find((b) => b.textContent?.startsWith('Replace All'))!.click())
    snapshotProjectTexts.mockClear()
    await click('Yes, replace all')
    await settle()
    expect(container.textContent).toContain('changed on disk since the search, so nothing was replaced')
    expect(useDocumentStore.getState().buffers['/p/Draft/b.md'].body).toBe('buffer dragon')
    expect(useFindStore.getState().lastReplace).toBeNull()
    expect(snapshotProjectTexts).toHaveBeenCalled()
    await unmount()
  })

  it('leaves out unchecked matches from Replace All', async () => {
    const { container, buttons, unmount } = await project()
    await act(async () => container.querySelectorAll<HTMLInputElement>('section input[type="checkbox"]')[0].click())
    expect(buttons().find((b) => b.textContent?.startsWith('Replace All'))!.textContent).toBe('Replace All (2 matches in 2 files)')
    await unmount()
  })

  it('selects the match in the editor of the open file, and opens closed files first', async () => {
    const { container, unmount } = await project()
    await act(async () => container.querySelectorAll<HTMLButtonElement>('section')[1].querySelector<HTMLButtonElement>('dialog li > button:first-of-type')!.click())
    expect(editor!.state.doc.textBetween(editor!.state.selection.from, editor!.state.selection.to)).toBe('dragon')
    expect(openFile).not.toHaveBeenCalled()
    await act(async () => container.querySelectorAll<HTMLButtonElement>('section')[0].querySelector<HTMLButtonElement>('dialog li > button:first-of-type')!.click())
    expect(openFile).toHaveBeenCalledWith('/p/Draft/a.md')
    await unmount()
  })

  it('walks across files with Next and ignores a stale search result', async () => {
    const { container, find, set, click, unmount } = await project()
    await click('Next')
    expect(openFile).toHaveBeenCalledWith('/p/Draft/a.md')
    let release: (value: typeof disk) => void = () => {}
    snapshotProjectTexts.mockReturnValueOnce(new Promise((resolve) => { release = resolve }))
    await set(find, 'dragon ')
    await settle()
    snapshotProjectTexts.mockResolvedValue([{ path: '/p/Draft/a.md', before: 'only here\n' }, { path: '/p/Draft/b.md', before: 'x\n' }])
    await set(find, 'only')
    await settle()
    release(disk)
    await settle()
    expect(container.querySelectorAll('section')).toHaveLength(1)
    expect(container.textContent).toContain('1 match in 1 file')
    await unmount()
  })
})
