import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { useDocumentStore } from '../../stores/documentStore'
import { FileTree } from './FileTree'
import { useExplorerStore } from '../../stores/explorerStore'
import { useTabStore } from '../../stores/tabStore'
import { Toolbar } from '../layout/Toolbar'

vi.mock('../../hooks/usePrint', () => ({ usePrint: () => vi.fn() }))

const openFileMock = vi.hoisted(() => vi.fn())
const moveEntryMock = vi.hoisted(() => vi.fn())
const openFolderMock = vi.hoisted(() => vi.fn())
const importIntoMock = vi.hoisted(() => vi.fn())
vi.mock('../../hooks/useFileSystem', () => ({
  useFileSystem: () => ({
    openWorkspace: vi.fn(), openRecent: vi.fn(), openFile: openFileMock,
    createFile: vi.fn(), createFolder: vi.fn(), renameEntry: vi.fn(), renameWorkspace: vi.fn(), moveEntry: moveEntryMock,
    openFolder: openFolderMock,
    importInto: importIntoMock,
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
  it('imports from the toolbar immediately before Export PDF into the selected binder section', async () => {
    useDocumentStore.getState().setWorkspace('/book', ['Draft', 'Research', 'Trash'].map((name) => ({ name, path: `/book/${name}`, isDirectory: true, children: [] })))
    const container = document.createElement('div')
    root = createRoot(container)
    await act(async () => root?.render(<><Toolbar visiblePanels={{ files: true, templates: true, snippets: true }} onTogglePanel={() => {}} /><FileTree /></>))
    for (const section of ['Draft', 'Research']) {
      await act(async () => container.querySelector<HTMLButtonElement>(`[aria-label="Collapse ${section}"]`)?.click())
      const buttons = Array.from(container.querySelectorAll('button')).filter((item) => item.textContent === 'Import')
      expect(buttons).toHaveLength(1)
      expect(buttons[0].closest('header')).not.toBeNull()
      expect(buttons[0].nextElementSibling?.textContent).toBe('Export PDF')
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
      if (name === 'Draft') expect(container.textContent).not.toContain('Chapter 1.md')
      await act(async () => container.querySelector<HTMLButtonElement>(`button[aria-label="Expand ${name}"]`)?.click())
      if (name === 'Draft') expect(container.textContent).toContain('Chapter 1.md')
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
    const file = Array.from(container.querySelectorAll('li > div')).find((row) => row.textContent?.includes('Chapter.md'))
    await act(async () => file?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 20, clientY: 20 })))

    expect(container.querySelector('[role="menuitem"]')?.textContent).toBe('Open')
    expect(container.textContent).toContain('Open in New Tab')
    expect(container.textContent).toContain('Move to Trash')

    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
        .find((button) => button.textContent === 'Open in New Tab')?.click()
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
      .find((button) => button.textContent === 'Open Containing Folder')
    expect(action).toBeDefined()
    await act(async () => action?.click())
    expect(openFolderMock).toHaveBeenCalledWith('/book/Research')
  })
})
