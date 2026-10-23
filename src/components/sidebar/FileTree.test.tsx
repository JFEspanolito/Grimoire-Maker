import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { useDocumentStore } from '../../stores/documentStore'
import { FileTree } from './FileTree'

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
})

describe('project explorer', () => {
  it('imports into the selected binder section', async () => {
    useDocumentStore.getState().setWorkspace('/book', [])
    const container = document.createElement('div')
    root = createRoot(container)
    await act(async () => root?.render(<FileTree />))
    for (const section of ['Draft', 'Research']) {
      const button = Array.from(container.querySelectorAll('button')).find((item) => item.textContent === `Import to ${section}`)
      await act(async () => button?.click())
      expect(importIntoMock).toHaveBeenCalledWith(section)
    }
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
})
