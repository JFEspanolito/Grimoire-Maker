import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { MenuBar } from './MenuBar'

const openWorkspace = vi.hoisted(() => vi.fn())
const saveFile = vi.hoisted(() => vi.fn())
vi.mock('../../hooks/useFileSystem', () => ({ useFileSystem: () => ({ openWorkspace, saveFile }), isTauri: () => false }))
vi.mock('../../hooks/usePrint', () => ({ usePrint: () => vi.fn() }))
vi.mock('../project/ProjectArchiveActions', () => ({ ProjectArchiveActions: () => <div>Archives</div> }))

it('groups application actions in keyboard-accessible menus', async () => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  const container = document.createElement('div')
  const root = createRoot(container)
  const toggle = vi.fn()
  await act(async () => root.render(<MenuBar visiblePanels={{ files: true, templates: true, snippets: true }} onTogglePanel={toggle} />))
  expect(Array.from(container.querySelectorAll('summary')).map((item) => item.textContent)).toEqual(['File', 'Project', 'View'])
  await act(async () => Array.from(container.querySelectorAll('button')).find((item) => item.textContent === 'Open Project…')?.click())
  expect(openWorkspace).toHaveBeenCalledOnce()
  await act(async () => Array.from(container.querySelectorAll('button')).find((item) => item.textContent === 'Save')?.click())
  expect(saveFile).toHaveBeenCalledOnce()
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Hide files panel"]')?.click())
  expect(toggle).toHaveBeenCalledWith('files')
  await act(async () => root.unmount())
})
