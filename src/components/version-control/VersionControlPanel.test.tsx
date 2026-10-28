import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VersionControlPanel } from './VersionControlPanel'
import { useDocumentStore } from '../../stores/documentStore'

const actions = vi.hoisted(() => ({
  getRepositoryStatus: vi.fn(), initializeRepository: vi.fn(), stageChange: vi.fn(),
  unstageChange: vi.fn(), revertChange: vi.fn(), rollbackToCommit: vi.fn(),
  diffCommit: vi.fn(), diffChange: vi.fn(), commitChanges: vi.fn(),
}))
vi.mock('../../lib/versionControl', () => actions)

const repository = {
  isRepository: true, branch: 'main', indexFingerprint: 'index-1',
  entries: [
    { path: 'chapter.md', originalPath: null, indexStatus: 'M', worktreeStatus: 'M' },
    { path: 'new.md', originalPath: null, indexStatus: '?', worktreeStatus: '?' },
  ],
  commits: [
    { hash: 'abc1234567890', shortHash: 'abc1234', subject: 'Auto-commit: 2026-10-28', timestamp: '2026-10-28' },
    { hash: 'def9876543210', shortHash: 'def9876', subject: 'Initial draft', timestamp: '2026-10-27' },
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
    HTMLDialogElement.prototype.showModal = function () { this.open = true }
    HTMLDialogElement.prototype.close = function () { this.open = false }
    actions.getRepositoryStatus.mockResolvedValue(repository)
    actions.diffChange.mockResolvedValue({ text: '+new text', binary: false, truncated: false })
    actions.diffCommit.mockResolvedValue({
      text: 'diff --git a/Draft/chapter.md b/Draft/chapter.md\n--- a/Draft/chapter.md\n+++ b/Draft/chapter.md\n@@ -1,1 +1,1 @@\n-broken draft\n+restored draft\n',
      binary: false,
      truncated: false,
    })
    useDocumentStore.getState().resetDocuments()
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
    expect(container.querySelector('dialog')?.open).toBe(true)
    expect(container.querySelector('[data-change="added"]')?.textContent).toContain('new text')
    await click('Close diff')
    await click('Stage new.md')
    expect(actions.stageChange).toHaveBeenCalledExactlyOnceWith('/books', 'new.md')
    await click('Unstage chapter.md')
    expect(actions.unstageChange).toHaveBeenCalledExactlyOnceWith('/books', 'chapter.md')
    expect(actions.commitChanges).not.toHaveBeenCalled()
  })

  it('refreshes changes after an automatic commit event without mutating Git', async () => {
    await render()
    actions.getRepositoryStatus.mockResolvedValue({ ...repository, entries: [] })
    await act(async () => window.dispatchEvent(new Event('grimoire:repository-changed')))
    expect(container.textContent).toContain('Working tree clean.')
    expect(actions.commitChanges).not.toHaveBeenCalled()
    expect(actions.stageChange).not.toHaveBeenCalled()
  })

  it('shows aligned Original and Incoming change columns with removed and added lines in a modal', async () => {
    actions.diffChange.mockResolvedValueOnce({ text: 'diff --git a/chapter.md b/chapter.md\n--- a/chapter.md\n+++ b/chapter.md\n@@ -1,2 +1,2 @@\n-old text\n+new text\n same text\n', binary: false, truncated: false })
    await render()
    await click('View unstaged diff for chapter.md')
    const modal = container.querySelector('dialog')!
    expect(modal.open).toBe(true)
    expect(modal.textContent).toContain('Original')
    expect(modal.textContent).toContain('Incoming change')
    expect(modal.querySelector('[data-change="removed"]')?.textContent).toContain('old text')
    expect(modal.querySelector('[data-change="added"]')?.textContent).toContain('new text')
    expect(container.querySelector('details')).toBeNull()
    await act(async () => modal.dispatchEvent(new Event('cancel', { cancelable: true })))
    expect(container.querySelector('dialog')).toBeNull()
    expect(actions.stageChange).not.toHaveBeenCalled()
    expect(actions.commitChanges).not.toHaveBeenCalled()
  })

  it('shows binary/truncation and fetch errors inside the modal', async () => {
    actions.diffChange.mockResolvedValueOnce({ text: '', binary: true, truncated: true })
    await render()
    await click('View unstaged diff for chapter.md')
    expect(container.querySelector('dialog')!.textContent).toContain('Binary file')
    expect(container.querySelector('dialog')!.textContent).toContain('Preview truncated')
    await click('Close diff')
    actions.diffChange.mockRejectedValueOnce(new Error('Cannot read diff'))
    await click('View unstaged diff for chapter.md')
    expect(container.querySelector('dialog [role="alert"]')!.textContent).toContain('Cannot read diff')
    await click('Close diff')
  })

  it('can close while loading without reopening when the response arrives', async () => {
    let finish!: (value: { text: string; binary: boolean; truncated: boolean }) => void
    actions.diffChange.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    await render()
    await click('View unstaged diff for chapter.md')
    expect(container.querySelector('dialog [role="status"]')!.textContent).toContain('Loading')
    await click('Close diff')
    await act(async () => finish({ text: '+late', binary: false, truncated: false }))
    expect(container.querySelector('dialog')).toBeNull()
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

  it('explains missing Git and links to the official download page without enabling Git actions', async () => {
    actions.getRepositoryStatus.mockRejectedValueOnce('Source Control requires Git. Please download it from https://git-scm.com/install/.')
    await render()
    const alert = container.querySelector('[role="alert"]')!
    expect(alert.textContent).toContain('Source Control requires Git. Please download it from')
    const link = alert.querySelector('a')!
    expect(link?.getAttribute('href')).toBe('https://git-scm.com/install/')
    expect(link.textContent).toBe('the official Git website')
    expect(container.querySelector('[aria-label="Stage new.md"]')).toBeNull()
    expect(actions.initializeRepository).not.toHaveBeenCalled()
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

  it('opens a right-click context menu with View Diff, Add, Remove from commit, and Revert', async () => {
    await render('/books')
    const unstagedRow = container.querySelector<HTMLButtonElement>('button[aria-label="View unstaged diff for new.md"]')!.closest('li')!
    await act(async () => {
      unstagedRow.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 80, clientY: 120 }))
    })
    const menu = container.querySelector<HTMLElement>('[role="menu"][aria-label="new.md actions"]')!
    expect(menu).not.toBeNull()
    const items = Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
    expect(items.map((item) => item.textContent)).toEqual(['View Diff', 'Add', 'Remove from commit', 'Revert'])
    expect(items[1].disabled).toBe(false)
    expect(items[2].disabled).toBe(true)

    await act(async () => items[1].click())
    expect(actions.stageChange).toHaveBeenCalledExactlyOnceWith('/books', 'new.md')

    const stagedRow = container.querySelector<HTMLButtonElement>('button[aria-label="View staged diff for chapter.md"]')!.closest('li')!
    await act(async () => {
      stagedRow.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 80, clientY: 120 }))
    })
    const stagedMenu = container.querySelector<HTMLElement>('[role="menu"][aria-label="chapter.md actions"]')!
    const stagedItems = Array.from(stagedMenu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
    expect(stagedItems[1].disabled).toBe(true)
    expect(stagedItems[2].disabled).toBe(false)
    await act(async () => stagedItems[3].click())

    const confirmDialog = container.querySelector<HTMLDialogElement>('dialog[aria-labelledby="confirm-title"]')!
    expect(confirmDialog.textContent).toContain('Discard all changes in "chapter.md"')
    const confirmBtn = Array.from(confirmDialog.querySelectorAll('button')).find((b) => b.textContent === 'Revert')!
    await act(async () => confirmBtn.click())
    expect(actions.revertChange).toHaveBeenCalledExactlyOnceWith('/books', 'chapter.md')
  })

  it('reverts a file directly from the inline Revert button and opens the Rollback modal with diff preview', async () => {
    useDocumentStore.getState().loadFromRaw('/books/Draft/chapter.md', '# Draft')
    await render('/books')

    // Click inline Revert button on new.md
    await click('Revert new.md')
    const revertDialog = container.querySelector<HTMLDialogElement>('dialog[aria-labelledby="confirm-title"]')!
    expect(revertDialog.textContent).toContain('Delete "new.md"?')
    const revertBtn = Array.from(revertDialog.querySelectorAll('button')).find((b) => b.textContent === 'Revert')!
    await act(async () => revertBtn.click())
    expect(actions.revertChange).toHaveBeenCalledExactlyOnceWith('/books', 'new.md')

    // Click the Recent checkpoints (Rollback) button to open the rollback modal
    await click('Recent checkpoints (Rollback)')
    const rollbackModal = container.querySelector<HTMLDialogElement>('dialog[aria-labelledby="git-rollback-title"]')!
    expect(rollbackModal).not.toBeNull()
    expect(rollbackModal.open).toBe(true)
    expect(actions.diffCommit).toHaveBeenCalledWith('/books', 'abc1234567890')
    expect(rollbackModal.querySelector('[data-change="removed"]')?.textContent).toContain('broken draft')
    expect(rollbackModal.querySelector('[data-change="added"]')?.textContent).toContain('restored draft')

    // Select the second checkpoint in the list and verify its diff is fetched
    await click('Rollback to def9876')
    expect(actions.diffCommit).toHaveBeenCalledWith('/books', 'def9876543210')

    // Confirm rollback for the active file only
    const restoreFileBtn = Array.from(rollbackModal.querySelectorAll('button')).find((b) => b.textContent === 'Restore "Draft/chapter.md" only')!
    await act(async () => restoreFileBtn.click())
    expect(actions.rollbackToCommit).toHaveBeenCalledExactlyOnceWith('/books', 'def9876543210', 'Draft/chapter.md')
  })
})
