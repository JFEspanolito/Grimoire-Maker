import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { MenuBar } from './MenuBar'
import { Toolbar } from './Toolbar'
import { useTabStore } from '../../stores/tabStore'
import { useSettingsStore } from '../../stores/settingsStore'

const openWorkspace = vi.hoisted(() => vi.fn())
const saveFile = vi.hoisted(() => vi.fn())
const createNewFile = vi.hoisted(() => vi.fn())
const createProject = vi.hoisted(() => vi.fn())
vi.mock('../../hooks/useFileSystem', () => ({ useFileSystem: () => ({ openWorkspace, saveFile, createNewFile, createProject }), isTauri: () => false }))
vi.mock('../../hooks/usePrint', () => ({ usePrint: () => vi.fn() }))
vi.mock('../project/ProjectArchiveActions', () => ({ ProjectArchiveActions: () => <div>Archives</div> }))

it('groups application actions in keyboard-accessible menus', async () => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  const container = document.createElement('div')
  const root = createRoot(container)
  const toggle = vi.fn()
  await act(async () => root.render(<MenuBar visiblePanels={{ files: true, templates: true, snippets: true }} onTogglePanel={toggle} />))
  expect(Array.from(container.querySelectorAll('summary')).map((item) => item.textContent)).toEqual(['File', 'View', 'Settings'])
  await act(async () => Array.from(container.querySelectorAll('button')).find((item) => item.textContent === 'Open Folder…')?.click())
  expect(openWorkspace).toHaveBeenCalledOnce()
  await act(async () => Array.from(container.querySelectorAll('button')).find((item) => item.textContent === 'Save')?.click())
  expect(saveFile).toHaveBeenCalledOnce()
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Hide files panel"]')?.click())
  expect(toggle).toHaveBeenCalledWith('files')
  await act(async () => root.unmount())
})

it('has reversible marked view actions and no duplicated toolbar commands', async () => {
  useTabStore.getState().reset('/chapter.md')
  useSettingsStore.getState().setViewMode('edit')
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    await act(async () => root.render(<><MenuBar visiblePanels={{ files: true, templates: true, snippets: true }} onTogglePanel={() => {}} /><Toolbar /></>))
    const view = Array.from(container.querySelectorAll('details')).find((menu) => menu.querySelector('summary')?.textContent === 'View')!
    const split = view.querySelector<HTMLButtonElement>('[aria-label="Split View"]')!
    expect(split?.getAttribute('aria-pressed')).toBe('false')
    await act(async () => split.click())
    expect(split.getAttribute('aria-pressed')).toBe('true')
    expect(split.textContent).toContain('✓')
    const page = view.querySelector<HTMLButtonElement>('[aria-label="Page View"]')!
    expect(page?.getAttribute('aria-pressed')).toBe('false')
    await act(async () => page.click())
    expect(useSettingsStore.getState().viewMode).toBe('pages')
    expect(page.getAttribute('aria-pressed')).toBe('true')
    await act(async () => page.click())
    expect(useSettingsStore.getState().viewMode).toBe('edit')
    expect(page.getAttribute('aria-pressed')).toBe('false')
    const toolbar = container.querySelector('header')!
    for (const label of ['Open', 'Save', 'Import', 'Export PDF', 'Files', 'Templates', 'Snippets', 'Split View']) {
      expect(Array.from(toolbar.querySelectorAll('button')).some((button) => button.textContent?.trim() === label)).toBe(false)
    }
    expect(toolbar.querySelector('[aria-label="Theme"]')).toBeNull()
    expect(toolbar.querySelector('[aria-label="View"]')).toBeNull()
    const settings = Array.from(container.querySelectorAll('details')).find((menu) => menu.querySelector('summary')?.textContent === 'Settings')!
    expect(settings.textContent).toContain('Mod Manager')
    expect(settings.textContent).toContain('Preferences…')
  } finally {
    await act(async () => root.unmount())
    useTabStore.getState().reset(null)
    useSettingsStore.getState().setViewMode('edit')
  }
})

it('makes file creation and opening folders discoverable in File', async () => {
  const container = document.createElement('div')
  const root = createRoot(container)
  await act(async () => root.render(<MenuBar visiblePanels={{ files: true, templates: true, snippets: true }} onTogglePanel={() => {}} />))
  const buttons = Array.from(container.querySelector('details')!.querySelectorAll('button'))
  expect(buttons.slice(0, 4).map((button) => button.textContent)).toEqual(['New File…', 'New Project…', 'Open File…', 'Open Folder…'])
  await act(async () => buttons[0].click())
  expect(createNewFile).toHaveBeenCalledOnce()
  openWorkspace.mockClear()
  await act(async () => buttons[3].click())
  expect(openWorkspace).toHaveBeenCalledOnce()
  await act(async () => root.unmount())
})

it('keeps the new project dialog open on picker cancellation or error and closes after creation', async () => {
  const showModal = vi.fn()
  const originalShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal')
  const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close')
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: showModal })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: vi.fn() })
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    await act(async () => root.render(<MenuBar visiblePanels={{ files: true, templates: true, snippets: true }} onTogglePanel={() => {}} />))
    await act(async () => Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'New Project…')?.click())
    expect(showModal).toHaveBeenCalledOnce()
    expect(container.querySelector('dialog')?.textContent).toContain('Choose Location & Create')
    const submit = async () => act(async () => { container.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    createProject.mockResolvedValueOnce(false)
    await submit()
    expect(createProject).toHaveBeenCalledWith('My Grimoire')
    expect(container.querySelector('dialog')).not.toBeNull()
    createProject.mockRejectedValueOnce(new Error('Folder already exists'))
    await submit()
    expect(container.querySelector('dialog [role="alert"]')?.textContent).toBe('Folder already exists')
    createProject.mockResolvedValueOnce(true)
    await submit()
    expect(container.querySelector('dialog')).toBeNull()
  } finally {
    await act(async () => root.unmount())
    if (originalShow) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', originalShow)
    else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
    if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, 'close', originalClose)
    else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close')
  }
})
