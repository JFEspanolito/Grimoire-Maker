import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PreferencesDialog } from './PreferencesDialog'
import { useSettingsStore } from '../../stores/settingsStore'

const mocks = vi.hoisted(() => ({
  load: vi.fn(), change: vi.fn(), themes: vi.fn().mockResolvedValue(undefined), templates: vi.fn().mockResolvedValue(undefined),
  paths: { plugins: '/config/Mods/Plugins', snippets: '/config/Mods/Snippets', templates: '/config/Mods/Templates', themes: '/config/themes' },
  errors: [] as string[],
}))
vi.mock('../../lib/preferences', () => ({ loadLibraryPaths: mocks.load, changeLibraryPath: mocks.change }))
vi.mock('../../hooks/useFileSystem', () => ({ isTauri: () => true }))
vi.mock('../../stores/themeStore', () => ({ useThemeStore: Object.assign(() => ({
  themes: [{ id: 'parchment', name: 'Parchment' }, { id: 'modern', name: 'Modern' }, { id: 'sci-fi', name: 'Sci-Fi' }], errors: [],
}), { getState: () => ({ reload: mocks.themes, errors: mocks.errors }) }) }))
vi.mock('../../stores/templateStore', () => ({ useTemplateStore: { getState: () => ({ reload: mocks.templates, errors: [] }) } }))

let root: Root
let container: HTMLDivElement
let onClose: ReturnType<typeof vi.fn<() => void>>
const originalShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal')
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close')
beforeEach(async () => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: vi.fn() })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: vi.fn() })
  mocks.load.mockResolvedValue({ ...mocks.paths })
  mocks.errors = []
  onClose = vi.fn()
  useSettingsStore.getState().setTheme('parchment')
  container = document.createElement('div')
  root = createRoot(container)
  await act(async () => root.render(<PreferencesDialog onClose={onClose} />))
})
afterEach(async () => {
  await act(async () => root.unmount())
  if (originalShow) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', originalShow)
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
  if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, 'close', originalClose)
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close')
  vi.clearAllMocks()
  useSettingsStore.getState().setTheme('parchment')
})

const edit = () => container.querySelector<HTMLButtonElement>('[aria-label="Edit Template Path"]')!
const templatePath = () => container.querySelector<HTMLInputElement>('[aria-label="Template Path"]')!.value

it('shows four configured directories and selects an existing theme', async () => {
  for (const label of ['Plugin Path', 'Snippet Path', 'Template Path', 'Theme Path']) {
    expect(container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)?.value).toMatch(/^\/config\//)
    expect(container.querySelector<HTMLButtonElement>(`[aria-label="Edit ${label}"]`)?.disabled).toBe(false)
  }
  const theme = container.querySelector('select')!
  expect(Array.from(theme.options).map((option) => option.text)).toEqual(['Parchment', 'Modern', 'Sci-Fi'])
  await act(async () => { theme.value = 'sci-fi'; theme.dispatchEvent(new Event('change', { bubbles: true })) })
  expect(useSettingsStore.getState().theme).toBe('sci-fi')
})

it('activates copied directories and reloads themes before templates', async () => {
  mocks.change.mockResolvedValueOnce({ ...mocks.paths, templates: '/new/templates' })
  await act(async () => edit().click())
  expect(mocks.change).toHaveBeenCalledWith('templates')
  expect(templatePath()).toBe('/new/templates')
  expect(mocks.themes.mock.invocationCallOrder[0]).toBeLessThan(mocks.templates.mock.invocationCallOrder[0]!)
  expect(container.querySelector('[role="status"]')?.textContent).toContain('originals were kept')
  expect(container.querySelector('[role="status"]')?.textContent).toContain('No restart needed')
})

it('reports reload errors without claiming that saved content was refreshed', async () => {
  mocks.change.mockResolvedValueOnce({ ...mocks.paths, templates: '/new/templates' })
  mocks.errors = ['Invalid theme package']
  await act(async () => edit().click())
  expect(templatePath()).toBe('/new/templates')
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('saved, but')
  expect(container.querySelector('[role="status"]')).toBeNull()
})

it('keeps the old path on cancellation or copy failure', async () => {
  mocks.change.mockResolvedValueOnce(null)
  await act(async () => edit().click())
  expect(templatePath()).toBe(mocks.paths.templates)
  expect(mocks.themes).not.toHaveBeenCalled()
  mocks.change.mockRejectedValueOnce(new Error('Destination already contains this template'))
  await act(async () => edit().click())
  expect(templatePath()).toBe(mocks.paths.templates)
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('already contains')
})

it('prevents closing or starting another copy while one is pending', async () => {
  let finish!: (value: null) => void
  mocks.change.mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
  await act(async () => edit().click())
  expect(edit().disabled).toBe(true)
  expect(container.querySelector<HTMLButtonElement>('[aria-label="Close preferences"]')?.disabled).toBe(true)
  await act(async () => container.querySelector('dialog')?.dispatchEvent(new Event('cancel', { cancelable: true })))
  expect(onClose).not.toHaveBeenCalled()
  await act(async () => finish(null))
  expect(edit().disabled).toBe(false)
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Close preferences"]')?.click())
  expect(onClose).toHaveBeenCalledOnce()
})
