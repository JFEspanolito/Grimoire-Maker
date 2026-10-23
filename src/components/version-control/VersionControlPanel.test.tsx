import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VersionControlPanel } from './VersionControlPanel'

const actions = vi.hoisted(() => ({
  getRepositoryStatus: vi.fn(), initializeRepository: vi.fn(), stageChange: vi.fn(),
  unstageChange: vi.fn(), diffChange: vi.fn(), commitChanges: vi.fn(),
}))
vi.mock('../../lib/versionControl', () => actions)

const repository = {
  isRepository: true, branch: 'main', indexFingerprint: 'index-1',
  entries: [
    { path: 'chapter.md', originalPath: null, indexStatus: 'M', worktreeStatus: 'M' },
    { path: 'new.md', originalPath: null, indexStatus: '?', worktreeStatus: '?' },
  ],
}

let root: Root
let container: HTMLDivElement

async function render(workspace = '/books', hasUnsavedChanges = false) {
  await act(async () => root.render(<VersionControlPanel workspace={workspace} hasUnsavedChanges={hasUnsavedChanges} />))
}

async function click(label: string) {
  const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  expect(button).not.toBeNull()
  await act(async () => button!.click())
}

describe('VersionControlPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.clearAllMocks()
    actions.getRepositoryStatus.mockResolvedValue(repository)
    actions.diffChange.mockResolvedValue({ text: '+new text', binary: false, truncated: false })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it('shows both staged and unstaged sections, diffs, explicit actions and unsaved warning', async () => {
    await render('/books', true)
    expect(container.textContent).toContain('Unsaved editor changes are not included')
    expect(container.textContent).toContain('Staged changes')
    expect(container.textContent).toContain('Untracked files')
    await click('View staged diff for chapter.md')
    expect(actions.diffChange).toHaveBeenCalledWith('/books', 'chapter.md', true)
    expect(container.querySelector('pre')?.textContent).toBe('+new text')
    await click('Stage new.md')
    expect(actions.stageChange).toHaveBeenCalledExactlyOnceWith('/books', 'new.md')
    await click('Unstage chapter.md')
    expect(actions.unstageChange).toHaveBeenCalledExactlyOnceWith('/books', 'chapter.md')
    expect(actions.commitChanges).not.toHaveBeenCalled()
  })

  it('commits explicitly once while pending, with the displayed index fingerprint', async () => {
    await render()
    let finish: (() => void) | undefined
    actions.commitChanges.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
    const input = container.querySelector('textarea')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'Write chapter')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const form = container.querySelector('form')!
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    expect(actions.commitChanges).toHaveBeenCalledExactlyOnceWith('/books', 'Write chapter', 'index-1')
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true)
    await act(async () => finish!())
    expect(container.textContent).toContain('Staged changes committed.')
  })

  it('does not initialize on mount and displays native errors', async () => {
    actions.getRepositoryStatus.mockResolvedValueOnce({ ...repository, isRepository: false, entries: [] })
    actions.initializeRepository.mockRejectedValueOnce(new Error('Inside another repository'))
    await render()
    expect(actions.initializeRepository).not.toHaveBeenCalled()
    const button = Array.from(container.querySelectorAll('button')).find((item) => item.textContent === 'Initialize Git repository')!
    await act(async () => button.click())
    expect(actions.initializeRepository).toHaveBeenCalledExactlyOnceWith('/books')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Inside another repository')
  })

  it('ignores an old project status response after switching workspace', async () => {
    let resolveOld: ((value: typeof repository) => void) | undefined
    actions.getRepositoryStatus.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve }))
    await render('/old')
    await render('/new')
    await act(async () => resolveOld!({ ...repository, branch: 'old-branch' }))
    expect(container.textContent).toContain('Branch: main')
    expect(container.textContent).not.toContain('old-branch')
  })
})
