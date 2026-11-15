import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { GitRollbackDialog } from './GitRollbackDialog'
import { diffCommit, type GitDiff } from '../../lib/versionControl'

vi.mock('../../lib/versionControl', () => ({ diffCommit: vi.fn() }))
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)

it('discards late preview responses when switching versions and selects the newest preview files', async () => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: vi.fn() })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: vi.fn() })
  let finish!: (diff: GitDiff) => void
  vi.mocked(diffCommit).mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    .mockResolvedValueOnce({ text: 'diff --git a/new.md b/new.md\n--- a/new.md\n+++ b/new.md\n@@ -1 +1 @@\n-old\n+Current preview', binary: false, truncated: false })
  const commits = ['first', 'second'].map(hash => ({ hash, shortHash: hash, subject: hash, timestamp: '2026-11-15' }))
  const host = document.createElement('div')
  const root = createRoot(host)
  try {
    await act(async () => root.render(<GitRollbackDialog workspace="/book" commits={commits} activeRelativePath={null} busy={false} onClose={() => {}} onRollback={() => {}} />))
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Rollback to second"]')!.click())
    const checkbox = host.querySelector<HTMLInputElement>('input[type="checkbox"]')
    expect(checkbox?.checked).toBe(true)
    expect(host.textContent).toContain('new.md')
    await act(async () => finish({ text: 'Stale preview', binary: false, truncated: false }))
    expect(host.textContent).not.toContain('Stale preview')
    expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(true)
    expect(diffCommit).toHaveBeenNthCalledWith(2, '/book', 'second')
  } finally { await act(async () => root.unmount()) }
})
