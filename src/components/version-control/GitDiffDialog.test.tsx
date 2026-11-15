import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { GitDiffDialog } from './GitDiffDialog'
import type { GitDiff } from '../../lib/versionControl'

it('preserves existing diff rows when an earlier hunk is inserted', async () => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  const originalShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal')
  const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close')
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: vi.fn() })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: vi.fn() })
  const container = document.createElement('div')
  const root = createRoot(container)
  const render = (text: string) => root.render(<GitDiffDialog path="a.md" staged={false}
    diff={{ text, binary: false, truncated: false } as GitDiff} loading={false} error="" onClose={() => {}} />)
  try {
    await act(async () => render('@@ -10 +10 @@\n-old\n+new'))
    const row = container.querySelector('tbody tr')
    await act(async () => render('@@ -1 +1 @@\n-first\n+second\n@@ -10 +10 @@\n-old\n+new'))
    expect(container.querySelectorAll('tbody tr')[1]).toBe(row)
  } finally {
    await act(async () => root.unmount())
    vi.restoreAllMocks()
    for (const [name, descriptor] of [['showModal', originalShow], ['close', originalClose]] as const) {
      if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor)
      else Reflect.deleteProperty(HTMLDialogElement.prototype, name)
    }
  }
})
