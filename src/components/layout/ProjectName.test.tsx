import { useProjectStore } from '../../stores/projectStore'
import { loadProjectSettings, saveProjectSettings } from '../../lib/projectSettings'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { useDocumentStore } from '../../stores/documentStore'
import { ProjectName } from './ProjectName'

const renameWorkspace = vi.hoisted(() => vi.fn())
vi.mock('../../hooks/useFileSystem', () => ({ useFileSystem: () => ({ renameWorkspace }) }))

vi.mock('../../lib/projectSettings', () => ({
  EMPTY_PROJECT: { name: '', author: '', coAuthor: '' },
  loadProjectSettings: vi.fn(async () => ({ name: '', author: 'Alice', coAuthor: 'Bob' })),
  saveProjectSettings: vi.fn(async () => {}),
}))
let root: Root | null = null
beforeAll(() => Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true))
afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = null
  document.body.replaceChildren()
  useDocumentStore.getState().setWorkspace(null, [])
  vi.clearAllMocks()
  useProjectStore.setState({ entries: {} })
})

describe('project name', () => {
  it('edits project metadata without renaming the folder or changing its pages', async () => {
    useDocumentStore.getState().setWorkspace('/projects/Old Project', [])
    useDocumentStore.getState().loadFromRaw('/projects/Old Project/chapter.md', '# Unchanged')
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(<ProjectName />))

    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Rename project"]')?.click())
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Project name"]')
    expect(input).not.toBeNull()
    await act(async () => {
      if (!input) return
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'New Project')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Save project name"]')?.click())

    expect(renameWorkspace).not.toHaveBeenCalled()
    expect(saveProjectSettings).toHaveBeenCalledWith('/projects/Old Project', { name: 'New Project', author: 'Alice', coAuthor: 'Bob' })
    expect(useDocumentStore.getState().workspaceRoot).toBe('/projects/Old Project')
    expect(useDocumentStore.getState().document.path).toBe('/projects/Old Project/chapter.md')
    expect(container.textContent).toContain('New Project')
  })

  it('uses the project folder as a fallback name instead of a chapter title', async () => {
    useDocumentStore.getState().setWorkspace('/projects/My Grimoire', [])
    useDocumentStore.getState().loadFromRaw('/projects/My Grimoire/Draft/chapter.md', '---\ntitle: Chapter One\n---\n# Chapter')
    const container = document.createElement('div')
    root = createRoot(container)
    await act(async () => root?.render(<ProjectName />))

    expect(container.textContent).toContain('My Grimoire')
    expect(container.textContent).not.toContain('Chapter One')
  })
})

it('shows the same saved book name as Properties and keeps it through folder changes', async () => {
  vi.mocked(loadProjectSettings).mockResolvedValueOnce({ name: 'My Book', author: 'Alice', coAuthor: '' })
  useDocumentStore.getState().setWorkspace('/projects/folder-name', [])
  const container = document.createElement('div')
  root = createRoot(container)
  await act(async () => root?.render(<ProjectName />))
  expect(container.textContent).toContain('My Book')
  await act(async () => useProjectStore.getState().save('/projects/folder-name', { name: 'Updated from Properties', author: 'Alice', coAuthor: '' }))
  expect(container.textContent).toContain('Updated from Properties')
  expect(renameWorkspace).not.toHaveBeenCalled()
})
