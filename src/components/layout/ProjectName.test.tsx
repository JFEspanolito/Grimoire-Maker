import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { useDocumentStore } from '../../stores/documentStore'
import { ProjectName } from './ProjectName'

const renameWorkspace = vi.hoisted(() => vi.fn())
vi.mock('../../hooks/useFileSystem', () => ({ useFileSystem: () => ({ renameWorkspace }) }))

let root: Root | null = null
beforeAll(() => Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true))
afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = null
  document.body.replaceChildren()
  useDocumentStore.getState().setWorkspace(null, [])
  vi.clearAllMocks()
})

describe('project name', () => {
  it('renames the project from the toolbar', async () => {
    useDocumentStore.getState().setWorkspace('/projects/Old Project', [])
    renameWorkspace.mockImplementation(async () => {
      useDocumentStore.getState().setWorkspace('/projects/New Project', [])
      return '/projects/New Project'
    })
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

    expect(renameWorkspace).toHaveBeenCalledWith('New Project')
    expect(container.textContent).toContain('New Project')
  })

  it('uses the project folder name instead of a chapter title', async () => {
    useDocumentStore.getState().setWorkspace('/projects/My Grimoire', [])
    useDocumentStore.getState().loadFromRaw('/projects/My Grimoire/Draft/chapter.md', '---\ntitle: Chapter One\n---\n# Chapter')
    const container = document.createElement('div')
    root = createRoot(container)
    await act(async () => root?.render(<ProjectName />))

    expect(container.textContent).toContain('My Grimoire')
    expect(container.textContent).not.toContain('Chapter One')
  })
})
