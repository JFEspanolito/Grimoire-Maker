import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { useDocumentStore } from '../../stores/documentStore'
import { useSessionStore } from '../../stores/sessionStore'
import { FileTree } from './FileTree'
import { useExplorerStore } from '../../stores/explorerStore'
import { useTabStore } from '../../stores/tabStore'
import { MenuBar } from '../layout/MenuBar'

vi.mock('../../hooks/usePrint', () => ({ usePrint: () => vi.fn() }))

const openFileMock = vi.hoisted(() => vi.fn())
const moveEntryMock = vi.hoisted(() => vi.fn())
const openFolderMock = vi.hoisted(() => vi.fn())
const importIntoMock = vi.hoisted(() => vi.fn())
const renameEntryMock = vi.hoisted(() => vi.fn())
const deleteFromTrashMock = vi.hoisted(() => vi.fn())
const refreshTreeMock = vi.hoisted(() => vi.fn())
vi.mock('../../hooks/useFileSystem', () => ({
  useFileSystem: () => ({
    openWorkspace: vi.fn(), openRecent: vi.fn(), openFile: openFileMock,
    createFile: vi.fn(), createFolder: vi.fn(), renameEntry: renameEntryMock, renameWorkspace: vi.fn(), moveEntry: moveEntryMock,
    openFolder: openFolderMock,
    importInto: importIntoMock, deleteFromTrash: deleteFromTrashMock, refreshTree: refreshTreeMock,
  }),
}))

let root: Root | null = null
beforeAll(() => Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true))
afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = null
  useDocumentStore.getState().setWorkspace(null, [])
  useExplorerStore.getState().selectPath(null)
  useTabStore.getState().reset(null)
})

describe('project explorer', () => {
  it('shows descriptions only on the four default folders', async () => {
    useDocumentStore.getState().setWorkspace('/book', [
      { name: 'Draft', path: '/book/Draft', isDirectory: true, children: [] },
      { name: 'Research', path: '/book/Research', isDirectory: true, children: [] },
      { name: 'Trash', path: '/book/Trash', isDirectory: true, children: [] },
      { name: 'Assets', path: '/book/Assets', isDirectory: true, children: [] },
      {
        name: 'Research',
        path: '/book/Draft/Research',
        isDirectory: true,
        children: [],
      },
    ])
    const container = document.createElement('div')
    root = createRoot(container)
    await act(async () => root?.render(<FileTree />))

    expect(container.querySelector('[data-tree-path="/book/Draft"]')?.getAttribute('title')).toBe(
      'Files and folders for your project.',
    )
    expect(container.querySelector('[data-tree-path="/book/Research"]')?.getAttribute('title')).toBe(
      'Inspiration and reference sources.',
    )
    expect(container.querySelector('[data-tree-path="/book/Trash"]')?.getAttribute('title')).toBe(
      'Deleted files.',
    )
    expect(container.querySelector('[data-tree-path="/book/Assets"]')?.getAttribute('title')).toBe(
      'Images and other resources used in your project.',
    )
    expect(
      container
        .querySelector('[data-tree-path="/book/Draft/Research"]')
        ?.getAttribute('title'),
    ).toBeNull()
  })

  it('renames the selected image with F2 and commits its hidden extension on blur', async () => {
    renameEntryMock.mockClear()
    useDocumentStore.getState().setWorkspace('/book', [{ name: 'cover.JPG', path: '/book/cover.JPG', isDirectory: false }])
    const container = document.createElement('div')
    root = createRoot(container)
    await act(async () => root?.render(<FileTree />))
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true })))
    expect(container.querySelector('input')).toBeNull()
    await act(async () => container.querySelector<HTMLElement>('[data-tree-path]')!.click())
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', ctrlKey: true })))
    expect(container.querySelector('input')).toBeNull()
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true })))
    const input = container.querySelector('input')!
    expect(input?.value).toBe('cover')
    input.value = 'new.cover'
    await act(async () => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
    expect(renameEntryMock).toHaveBeenCalledExactlyOnceWith('/book/cover.JPG', 'new.cover.JPG')
  })
  it('pencil rename hides extensions, Escape cancels and Enter plus blur submits once', async () => {
    renameEntryMock.mockClear()
    useDocumentStore.getState().setWorkspace('/book', [{ name: 'cover.jpg', path: '/book/cover.jpg', isDirectory: false }])
    const container = document.createElement('div')
    root = createRoot(container)
    await act(async () => root?.render(<FileTree />))
    const edit = async () => {
      await act(async () => container.querySelector<HTMLButtonElement>('[title="Rename"]')!.click())
      return container.querySelector('input')!
    }
    const cancelled = await edit()
    expect(cancelled.value).toBe('cover')
    cancelled.value = 'discard'
    await act(async () => {
      cancelled.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      cancelled.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })
    expect(renameEntryMock).not.toHaveBeenCalled()
    const input = await edit()
    input.value = 'saved'
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })
    expect(renameEntryMock).toHaveBeenCalledExactlyOnceWith('/book/cover.jpg', 'saved.jpg')
  })
  it('does not use F2 for a selected folder or a file no longer in the tree', async () => {
    useDocumentStore.getState().setWorkspace('/book', [
      { name: 'folder', path: '/book/folder', isDirectory: true, children: [] },
      { name: 'cover.jpg', path: '/book/cover.jpg', isDirectory: false },
    ])
    const container = document.createElement('div')
    root = createRoot(container)
    await act(async () => root?.render(<FileTree />))
    await act(async () => container.querySelector<HTMLElement>('[data-tree-path="/book/folder"]')!.click())
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2' })))
    expect(container.querySelector('input')).toBeNull()
    await act(async () => container.querySelector<HTMLElement>('[data-tree-path="/book/cover.jpg"]')!.click())
    await act(async () => useDocumentStore.getState().setWorkspace('/other', []))
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2' })))
    expect(container.querySelector('input')).toBeNull()
  })
  it('hides file extensions without changing paths or directory names', async () => {
    useDocumentStore.getState().setWorkspace('/book', [
      { name: 'cover.jpg', path: '/book/cover.jpg', isDirectory: false },
      { name: 'chapter.one.md', path: '/book/chapter.one.md', isDirectory: false },
      { name: 'folder.jpg', path: '/book/folder.jpg', isDirectory: true, children: [] },
    ])
    const container = document.createElement('div')
    root = createRoot(container)
    await act(async () => root?.render(<FileTree />))
    const cover = container.querySelector<HTMLElement>('[data-tree-path="/book/cover.jpg"]')!
    expect(cover.textContent).toContain('cover')
    expect(cover.textContent).not.toContain('.jpg')
    expect(container.querySelector('[data-tree-path="/book/chapter.one.md"]')?.textContent).toContain('chapter.one')
    expect(container.querySelector('[data-tree-path="/book/folder.jpg"]')?.textContent).toContain('folder.jpg')
    await act(async () => cover.click())
    expect(openFileMock).toHaveBeenCalledWith('/book/cover.jpg')
  })
  it('copies the full file path and reports clipboard failures', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    const previous = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    try {
      useDocumentStore.getState().setWorkspace('H:/My Book', [
        { name: 'notes.md', path: 'H:/My Book/Chapter 1/notes.md', isDirectory: false },
      ])
      const container = document.createElement('div')
      root = createRoot(container)
      await act(async () => root?.render(<FileTree />))
      const copy = async () => {
        await act(async () => container.querySelector('li > div')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
        const action = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(button => button.textContent === 'Copy file path')!
        await act(async () => action.click())
      }
      await copy()
      expect(writeText).toHaveBeenCalledWith('H:/My Book/Chapter 1/notes.md')
      expect(container.querySelector('[role="menu"]')).toBeNull()
      writeText.mockRejectedValueOnce(new Error('Clipboard unavailable'))
      await copy()
      expect(container.textContent).toContain('Clipboard unavailable')
    } finally {
      if (previous) Object.defineProperty(navigator, 'clipboard', previous)
      else Reflect.deleteProperty(navigator, 'clipboard')
    }
  })
  it('hides Markdown extensions but retains disk paths and the extension when renaming', async () => {
    useDocumentStore.getState().setWorkspace('/book', [
      { name: 'Chapter.md', path: '/book/Chapter.md', isDirectory: false },
      { name: 'reference.pdf', path: '/book/reference.pdf', isDirectory: false },
      { name: 'folder.md', path: '/book/folder.md', isDirectory: true, children: [] },
    ])
    const container = document.createElement('div')
    root = createRoot(container)
    await act(async () => root?.render(<FileTree />))
    expect(container.textContent).toContain('Chapter')
    expect(container.textContent).not.toContain('Chapter.md')
    expect(container.textContent).toContain('reference')
    expect(container.textContent).not.toContain('reference.pdf')
    expect(container.textContent).toContain('folder.md')
    const row = container.querySelector<HTMLElement>('[data-tree-path="/book/Chapter.md"]')!
    await act(async () => row.click())
    expect(openFileMock).toHaveBeenCalledWith('/book/Chapter.md')
    await act(async () => row.querySelector<HTMLButtonElement>('[title="Rename"]')?.click())
    const input = container.querySelector('input')!
    expect(input.value).toBe('Chapter')
    input.value = 'Renamed'
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(renameEntryMock).toHaveBeenCalledWith('/book/Chapter.md', 'Renamed.md')
  })
  it('imports from the File menu into the selected binder section', async () => {
    useDocumentStore.getState().setWorkspace('/book', ['Draft', 'Research', 'Trash'].map((name) => ({ name, path: `/book/${name}`, isDirectory: true, children: [] })))
    const container = document.createElement('div')
    root = createRoot(container)
    await act(async () => root?.render(<><MenuBar visiblePanels={{ files: true, templates: true, snippets: true, git: true, properties: true }} onTogglePanel={() => {}} /><FileTree /></>))
    for (const section of ['Draft', 'Research']) {
      await act(async () => container.querySelector<HTMLButtonElement>(`[aria-label="Collapse ${section}"]`)?.click())
      const buttons = Array.from(container.querySelectorAll('button')).filter((item) => item.textContent === 'Import…')
      expect(buttons).toHaveLength(1)
      expect(buttons[0].closest('details')?.querySelector('summary')?.textContent).toBe('File')
      expect(buttons[0].title).toBe(`Import into ${section}`)
      await act(async () => buttons[0].click())
      expect(importIntoMock).toHaveBeenCalledWith()
    }
    await act(async () => useTabStore.getState().open('/book/Draft/open.md'))
    expect(container.querySelector<HTMLButtonElement>('[title="Import into Draft"]')).not.toBeNull()
  })
  it('shows the open project and the binder sections in Draft, Research, Trash order', async () => {
    useDocumentStore.getState().setWorkspace('/projects/My Grimoire', [
      { name: 'Trash', path: '/projects/My Grimoire/Trash', isDirectory: true, children: [] },
      { name: 'Research', path: '/projects/My Grimoire/Research', isDirectory: true, children: [] },
      { name: 'Draft', path: '/projects/My Grimoire/Draft', isDirectory: true, children: [] },
    ])

    const container = document.createElement('div')
    root = createRoot(container)
    await act(async () => root?.render(<FileTree />))

    expect(container.querySelector('[aria-label="Rename project in sidebar"]')).toBeNull()
    const rows = Array.from(container.querySelectorAll('li')).map((node) => node.textContent?.trim())
    expect(rows.map((row) => row?.replace('✎', '').trim())).toEqual(['▾Draft', '▾Research', '▾Trash'])
    for (const name of ['Draft', 'Research', 'Trash']) {
      const toggle = container.querySelector<HTMLButtonElement>(`button[aria-label="Collapse ${name}"]`)
      const row = toggle?.parentElement
      expect(row?.classList.contains('text-left')).toBe(true)
      expect(row?.classList.contains('justify-between')).toBe(false)
      expect(row?.querySelector<HTMLButtonElement>('button[title="Rename"]')?.classList.contains('ml-auto')).toBe(true)
      expect(row?.parentElement?.querySelector('ul')?.classList.contains('ml-2.5')).toBe(true)
    }
  })

  it('collapses and reopens each binder section without losing its children', async () => {
    useDocumentStore.getState().setWorkspace('/projects/My Grimoire', [
      {
        name: 'Draft', path: '/projects/My Grimoire/Draft', isDirectory: true,
        children: [{ name: 'Chapter 1.md', path: '/projects/My Grimoire/Draft/Chapter 1.md', isDirectory: false }],
      },
      { name: 'Research', path: '/projects/My Grimoire/Research', isDirectory: true, children: [] },
      { name: 'Trash', path: '/projects/My Grimoire/Trash', isDirectory: true, children: [] },
    ])

    const container = document.createElement('div')
    root = createRoot(container)
    await act(async () => root?.render(<FileTree />))

    for (const name of ['Draft', 'Research', 'Trash']) {
      const collapse = container.querySelector<HTMLButtonElement>(`button[aria-label="Collapse ${name}"]`)
      expect(collapse).not.toBeNull()
      await act(async () => collapse?.click())
      expect(container.querySelector(`button[aria-label="Expand ${name}"]`)).not.toBeNull()
      if (name === 'Draft') expect(container.textContent).not.toContain('Chapter 1')
      await act(async () => container.querySelector<HTMLButtonElement>(`button[aria-label="Expand ${name}"]`)?.click())
      if (name === 'Draft') expect(container.textContent).toContain('Chapter 1')
    }
  })

  it('opens Draft when creating a new file in a collapsed section', async () => {
    useDocumentStore.getState().setWorkspace('/projects/My Grimoire', [
      { name: 'Draft', path: '/projects/My Grimoire/Draft', isDirectory: true, children: [] },
      { name: 'Research', path: '/projects/My Grimoire/Research', isDirectory: true, children: [] },
      { name: 'Trash', path: '/projects/My Grimoire/Trash', isDirectory: true, children: [] },
    ])
    const container = document.createElement('div')
    root = createRoot(container)
    await act(async () => root?.render(<FileTree />))

    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Collapse Draft"]')?.click())
    await act(async () => container.querySelector<HTMLButtonElement>('button[title="New file"]')?.click())

    expect(container.querySelector('button[aria-label="Collapse Draft"]')).not.toBeNull()
    expect(container.querySelector('input[placeholder="file name"]')).not.toBeNull()
  })

  it('offers open, new tab, and move to Trash on a file context menu', async () => {
    useDocumentStore.getState().setWorkspace('/projects/My Grimoire', [
      { name: 'Draft', path: '/projects/My Grimoire/Draft', isDirectory: true,
        children: [{ name: 'Chapter.md', path: '/projects/My Grimoire/Draft/Chapter.md', isDirectory: false }] },
      { name: 'Trash', path: '/projects/My Grimoire/Trash', isDirectory: true, children: [] },
    ])
    const container = document.createElement('div')
    root = createRoot(container)
    await act(async () => root?.render(<FileTree />))
    const file = container.querySelector('[data-tree-path="/projects/My Grimoire/Draft/Chapter.md"]')
    await act(async () => file?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 20, clientY: 20 })))

    expect(container.querySelector('[role="menuitem"]')?.textContent).toBe('Open File')
    expect(container.textContent).toContain('Open in new Tab')
    expect(container.textContent).toContain('Move to Trash')

    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
        .find((button) => button.textContent === 'Open in new Tab')?.click()
    })
    expect(openFileMock).toHaveBeenCalledWith('/projects/My Grimoire/Draft/Chapter.md', true)

    await act(async () => file?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
        .find((button) => button.textContent === 'Move to Trash')?.click()
    })
    expect(moveEntryMock).toHaveBeenCalledWith(
      '/projects/My Grimoire/Draft/Chapter.md', '/projects/My Grimoire/Trash/Chapter.md',
    )
  })

  it('opens a folder in the system file explorer from its context menu', async () => {
    useDocumentStore.getState().setWorkspace('/projects/My Grimoire', [
      { name: 'Draft', path: '/projects/My Grimoire/Draft', isDirectory: true, children: [] },
    ])
    const container = document.createElement('div')
    root = createRoot(container)
    await act(async () => root?.render(<FileTree />))
    const folder = Array.from(container.querySelectorAll('li > div')).find((row) => row.textContent?.includes('Draft'))
    await act(async () => folder?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))

    const action = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
      .find((button) => button.textContent === 'Open Folder')
    expect(action).toBeDefined()
    await act(async () => action?.click())
    expect(openFolderMock).toHaveBeenCalledWith('/projects/My Grimoire/Draft')
  })

  it('opens the containing folder from a file context menu', async () => {
    useDocumentStore.getState().setWorkspace('/book', [
      { name: 'notes.md', path: '/book/Research/notes.md', isDirectory: false },
    ])
    const container = document.createElement('div')
    root = createRoot(container)
    await act(async () => root?.render(<FileTree />))
    await act(async () => container.querySelector('li > div')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    const action = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
      .find((button) => button.textContent === 'Open Folder')
    expect(action).toBeDefined()
    await act(async () => action?.click())
    expect(openFolderMock).toHaveBeenCalledWith('/book/Research')
  })
})

it('does not duplicate recent folders in the explorer', async () => {
  const previous = useSessionStore.getState().recentWorkspaces
  useSessionStore.getState().setRecentWorkspaces(['/books/Adventure'])
  const container = document.createElement('div')
  root = createRoot(container)
  try {
    await act(async () => root?.render(<FileTree />))
    expect(container.querySelector('[aria-label="Recent folders"]')).toBeNull()
  } finally { useSessionStore.getState().setRecentWorkspaces(previous) }
})

it('starts Asset and Assets collapsed, including asynchronously loaded trees, and preserves manual expansion', async () => {
  useDocumentStore.getState().setWorkspace('/book', [])
  const container = document.createElement('div')
  root = createRoot(container)
  await act(async () => root?.render(<FileTree />))
  const tree = ['Assets', 'asset', 'Draft'].map(name => ({
    name, path: `/book/${name}`, isDirectory: true,
    children: [{ name: 'image.png', path: `/book/${name}/image.png`, isDirectory: false }],
  }))
  await act(async () => useDocumentStore.getState().setWorkspace('/book', tree))
  expect(container.querySelector('[aria-label="Expand Assets"]')).not.toBeNull()
  expect(container.querySelector('[aria-label="Expand asset"]')).not.toBeNull()
  expect(container.querySelector('[aria-label="Collapse Draft"]')).not.toBeNull()
  expect(container.querySelector('[data-tree-path="/book/Assets/image.png"]')).toBeNull()
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Expand Assets"]')!.click())
  expect(container.querySelector('[data-tree-path="/book/Assets/image.png"]')).not.toBeNull()
  await act(async () => useDocumentStore.getState().setWorkspace('/book', [...tree]))
  expect(container.querySelector('[aria-label="Collapse Assets"]')).not.toBeNull()
})

describe('explorer toolbar and Trash', () => {
  it('refreshes the file list on demand', async () => {
    useDocumentStore.getState().setWorkspace('/book', [])
    const container = document.createElement('div')
    root = createRoot(container)
    await act(async () => root?.render(<FileTree />))
    const buttons = Array.from(container.querySelectorAll('button')).map((button) => button.getAttribute('aria-label') ?? button.textContent)
    expect(buttons.slice(0, 3)).toEqual(['+ File', '+ Folder', 'Refresh file list'])
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Refresh file list"]')!.click())
    expect(refreshTreeMock).toHaveBeenCalledOnce()
  })

  it('offers a confirmed Delete only for items already in Trash', async () => {
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: vi.fn() })
    Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: vi.fn() })
    useDocumentStore.getState().setWorkspace('/book', [
      { name: 'Draft', path: '/book/Draft', isDirectory: true, children: [{ name: 'Live.md', path: '/book/Draft/Live.md', isDirectory: false }] },
      { name: 'Trash', path: '/book/Trash', isDirectory: true, children: [{ name: 'Old.md', path: '/book/Trash/Old.md', isDirectory: false }] },
    ])
    const container = document.createElement('div')
    root = createRoot(container)
    await act(async () => root?.render(<FileTree />))
    const menuItems = () => Array.from(container.querySelectorAll('[role="menuitem"]'), (item) => item.textContent)
    const openMenu = (path: string) => act(async () => container.querySelector(`[data-tree-path="${path}"]`)?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 5, clientY: 5 })))
    await openMenu('/book/Draft/Live.md')
    expect(menuItems()).not.toContain('Delete…')
    await openMenu('/book/Trash/Old.md')
    expect(menuItems()).toContain('Delete…')
    expect(menuItems()).not.toContain('Move to Trash')
    const click = (label: string) => act(async () => Array.from(container.querySelectorAll<HTMLButtonElement>('button, [role="menuitem"]')).find((item) => item.textContent === label)!.click())
    await click('Delete…')
    const dialog = container.querySelector('dialog')!
    expect(dialog.textContent).toContain('recycle bin')
    await click('Cancel')
    expect(container.querySelector('dialog')).toBeNull()
    expect(deleteFromTrashMock).not.toHaveBeenCalled()
    await openMenu('/book/Trash/Old.md')
    await click('Delete…')
    await click('Delete')
    expect(deleteFromTrashMock).toHaveBeenCalledWith('/book/Trash/Old.md')
  })

  it('allows dismissing workspaceError with dismiss button', async () => {
    useDocumentStore.getState().setWorkspace('/book', [])
    useSessionStore.getState().setWorkspaceError('Could not open file: test error')
    const container = document.createElement('div')
    root = createRoot(container)
    await act(async () => root?.render(<FileTree />))

    const alert = container.querySelector('[role="alert"]')
    expect(alert).not.toBeNull()
    expect(alert?.textContent).toContain('Could not open file: test error')

    const dismissBtn = alert?.querySelector<HTMLButtonElement>('[aria-label="Dismiss error"]')
    expect(dismissBtn).not.toBeNull()
    await act(async () => dismissBtn?.click())

    expect(useSessionStore.getState().workspaceError).toBeNull()
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })
})
