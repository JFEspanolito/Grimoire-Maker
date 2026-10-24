import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { DocumentTabs } from './DocumentTabs'
import { useTabStore } from '../../stores/tabStore'

const openFile = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const closeTab = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('../../hooks/useFileSystem', () => ({ useFileSystem: () => ({ openFile, closeTab }) }))

it('hides Markdown suffixes in tabs, tooltips and close labels without changing file actions', async () => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  const tabs = useTabStore.getState()
  tabs.reset('/book/Chapter.MD')
  tabs.open('/book/image.png', true)
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    await act(async () => root.render(<DocumentTabs />))
    expect(container.textContent).toContain('Chapter')
    expect(container.textContent).not.toContain('.MD')
    expect(container.textContent).toContain('image.png')
    const tab = container.querySelector<HTMLButtonElement>('[title="/book/Chapter"]')!
    expect(tab).not.toBeNull()
    await act(async () => tab.click())
    expect(openFile).toHaveBeenCalledWith('/book/Chapter.MD')
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Close Chapter"]')?.click())
    expect(closeTab).toHaveBeenCalledWith('/book/Chapter.MD')
  } finally {
    await act(async () => root.unmount())
    tabs.reset(null)
  }
})
