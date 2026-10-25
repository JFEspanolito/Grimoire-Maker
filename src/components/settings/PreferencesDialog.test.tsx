import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PreferencesDialog } from './PreferencesDialog'
import { useSettingsStore } from '../../stores/settingsStore'

const mocks = vi.hoisted(() => ({
  load: vi.fn(), change: vi.fn(), themes: vi.fn().mockResolvedValue(undefined), templates: vi.fn().mockResolvedValue(undefined),
  deleteTheme: vi.fn().mockResolvedValue(undefined), exportTheme: vi.fn().mockResolvedValue(true),
  paths: { plugins: '/config/Mods/Plugins', snippets: '/config/Mods/Snippets', templates: '/config/Mods/Templates', themes: '/config/themes', logs: '/config/logs' },
  errors: [] as string[],
  userThemes: [{ id: 'custom-dark', name: 'Custom Dark', builtin: false }],
}))
vi.mock('../../lib/preferences', () => ({ loadLibraryPaths: mocks.load, changeLibraryPath: mocks.change }))
vi.mock('../../lib/themeEditor', () => ({ deleteUserTheme: mocks.deleteTheme, exportUserTheme: mocks.exportTheme }))
vi.mock('../../hooks/useFileSystem', () => ({ isTauri: () => true }))
vi.mock('./ThemeCustomizer', () => ({ ThemeCustomizer: ({ onClose, onBusyChange }: { onClose: () => void; onBusyChange: (busy: boolean) => void }) =>
  <section><h2 id="customize-theme-title">Customize Theme</h2><button onClick={onClose}>Back</button><button onClick={() => onBusyChange(true)}>Start saving</button><button onClick={() => onBusyChange(false)}>Finish saving</button></section>,
}))
vi.mock('../../stores/themeStore', () => ({ useThemeStore: Object.assign(() => ({
  themes: [{ id: 'parchment', name: 'Parchment', builtin: true }, { id: 'modern', name: 'Modern', builtin: true }, { id: 'sci-fi', name: 'Sci-Fi', builtin: true }, ...mocks.userThemes],
  userThemes: mocks.userThemes,
  errors: [],
}), { getState: () => ({ reload: mocks.themes, themes: [{ id: 'parchment', name: 'Parchment', builtin: true }, { id: 'modern', name: 'Modern', builtin: true }, { id: 'sci-fi', name: 'Sci-Fi', builtin: true }], errors: mocks.errors }) }) }))
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
  useSettingsStore.getState().setAutoCommitSettings(true, 20, 'update content automatically')
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
  useSettingsStore.getState().setAutoCommitSettings(true, 20, 'update content automatically')
})

const edit = () => container.querySelector<HTMLButtonElement>('[aria-label="Edit Template Path"]')!
const templatePath = () => container.querySelector<HTMLInputElement>('[aria-label="Template Path"]')!.value

it('shows all configured directories and selects an existing theme', async () => {
  for (const label of ['Plugin Path', 'Snippet Path', 'Template Path', 'Theme Path', 'Logs Path']) {
    expect(container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)?.value).toMatch(/^\/config\//)
    expect(container.querySelector<HTMLButtonElement>(`[aria-label="Edit ${label}"]`)?.disabled).toBe(false)
  }
  const theme = container.querySelector('select')!
  expect(Array.from(theme.options).map((option) => option.text)).toEqual(['Parchment', 'Modern', 'Sci-Fi', 'Custom Dark'])
  await act(async () => { theme.value = 'sci-fi'; theme.dispatchEvent(new Event('change', { bubbles: true })) })
  expect(useSettingsStore.getState().theme).toBe('sci-fi')
})

it('shows Export Theme and Delete Theme only when a custom user theme is selected', async () => {
  expect(Array.from(container.querySelectorAll('button')).some((b) => b.textContent === 'Export Theme')).toBe(false)
  expect(Array.from(container.querySelectorAll('button')).some((b) => b.textContent === 'Delete Theme')).toBe(false)

  const theme = container.querySelector('select')!
  await act(async () => { theme.value = 'custom-dark'; theme.dispatchEvent(new Event('change', { bubbles: true })) })

  const exportBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Export Theme')!
  const deleteBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Delete Theme')!
  expect(exportBtn).toBeDefined()
  expect(deleteBtn).toBeDefined()

  await act(async () => exportBtn.click())
  expect(mocks.exportTheme).toHaveBeenCalledExactlyOnceWith('custom-dark')
  expect(container.textContent).toContain('Theme "Custom Dark" exported.')

  await act(async () => deleteBtn.click())
  const confirmDialog = container.querySelector<HTMLDialogElement>('dialog[aria-labelledby="confirm-title"]')!
  expect(confirmDialog.textContent).toContain('Delete custom theme "Custom Dark"?')
  const confirmBtn = Array.from(confirmDialog.querySelectorAll('button')).find((b) => b.textContent === 'Delete')!
  await act(async () => confirmBtn.click())
  expect(mocks.deleteTheme).toHaveBeenCalledExactlyOnceWith('custom-dark')
  expect(mocks.themes).toHaveBeenCalledOnce()
  expect(useSettingsStore.getState().theme).toBe('parchment')
})

it('changes Logs Path immediately without unrelated catalog reloads', async () => {
  mocks.change.mockResolvedValueOnce({ ...mocks.paths, logs: '/new/logs' })
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Edit Logs Path"]')!.click())
  expect(mocks.change).toHaveBeenCalledWith('logs')
  expect(container.querySelector<HTMLInputElement>('[aria-label="Logs Path"]')?.value).toBe('/new/logs')
  expect(mocks.themes).not.toHaveBeenCalled()
  expect(container.textContent).toContain('without restarting')
})

it('opens customization in the same modal and protects an in-flight theme save', async () => {
  await act(async () => Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Customize Theme')!.click())
  expect(container.querySelectorAll('dialog')).toHaveLength(1)
  expect(container.querySelector('dialog')?.getAttribute('aria-labelledby')).toBe('customize-theme-title')
  await act(async () => Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Start saving')!.click())
  await act(async () => container.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true })))
  expect(onClose).not.toHaveBeenCalled()
  expect(container.querySelector('#customize-theme-title')).not.toBeNull()
  await act(async () => Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Finish saving')!.click())
  await act(async () => container.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true })))
  expect(container.querySelector('#preferences-title')).not.toBeNull()
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

it('organizes preferences with a section index and a basic shortcut reference', async () => {
  document.body.append(container)
  container.querySelector('dialog')!.open = true
  try {
    const tabs = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
    expect(tabs.map(tab => tab.textContent)).toEqual(['Appearance', 'Content folders', 'Shortcuts', 'Auto save', 'Project'])
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')
    await act(async () => tabs[2].click())
    const panel = container.querySelector<HTMLElement>('#preferences-shortcuts')!
    expect(panel.hidden).toBe(false)
    expect(container.querySelector<HTMLElement>('#preferences-appearance')!.hidden).toBe(true)
    const save = Array.from(panel.querySelectorAll('tr')).find(row => row.textContent?.includes('Save All'))!
    expect(Array.from(save.querySelectorAll('kbd')).map(key => key.textContent)).toEqual(['Ctrl', 'S'])
    expect(panel.textContent).toContain('Bold')
    for (const [label, direction] of [['Zoom In', 'Scroll Up'], ['Zoom Out', 'Scroll Down']]) {
      const row = Array.from(panel.querySelectorAll('tr')).find(item => item.textContent?.includes(label))!
      expect(Array.from(row.querySelectorAll('kbd')).map(key => key.textContent)).toEqual(['Ctrl', direction])
    }
    await act(async () => tabs[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })))
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(tabs[0])
    await act(async () => tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
    expect(container.querySelector<HTMLElement>('#preferences-folders')!.hidden).toBe(false)
    expect(tabs[1].getAttribute('aria-selected')).toBe('true')
  } finally { container.remove() }
})

it('exposes Auto save directly and applies minutes plus seconds without accepting invalid intervals', async () => {
  await act(async () => container.querySelector<HTMLButtonElement>('#preferences-tab-autosave')!.click())
  const panel = container.querySelector<HTMLElement>('#preferences-autosave')!
  expect(panel.hidden).toBe(false)
  const minutes = panel.querySelector<HTMLInputElement>('[aria-label="Auto save minutes"]')!
  const seconds = panel.querySelector<HTMLInputElement>('[aria-label="Auto save seconds"]')!
  expect(minutes.value).toBe('5'); expect(seconds.value).toBe('0')
  const change = async (input: HTMLInputElement, value: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    await act(async () => input.dispatchEvent(new Event('input', { bubbles: true })))
  }
  await change(minutes, '1'); await change(seconds, '30')
  await act(async () => panel.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(useSettingsStore.getState().autoSaveSeconds).toBe(90)
  await change(minutes, '0'); await change(seconds, '0')
  await act(async () => panel.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(useSettingsStore.getState().autoSaveSeconds).toBe(90)
  expect(panel.querySelector('[role="alert"]')?.textContent).toContain('1 second')
  useSettingsStore.getState().setAutoSaveSeconds(300)
})

it('exposes project settings in Preferences', async () => {
  await act(async () => container.querySelector<HTMLButtonElement>('#preferences-tab-project')!.click())
  const panel = container.querySelector<HTMLElement>('#preferences-project')!
  expect(panel.hidden).toBe(false)
  expect(panel.textContent).toContain('Project properties')
})


it('offers a separate Auto commits form with editable defaults and an off switch', async () => {
  await act(async () => container.querySelector<HTMLButtonElement>('#preferences-tab-autosave')!.click())
  const panel = container.querySelector<HTMLElement>('#preferences-autosave')!
  const enabled = panel.querySelector<HTMLInputElement>('[aria-label="Enable auto commits"]')!
  const minutes = panel.querySelector<HTMLInputElement>('[aria-label="Auto commit minutes"]')!
  const message = panel.querySelector<HTMLInputElement>('[aria-label="Auto commit message"]')!
  expect(enabled.checked).toBe(true)
  expect(minutes.value).toBe('20')
  expect(message.value).toBe('update content automatically')
  expect(panel.querySelectorAll('form')).toHaveLength(2)
  const change = async (input: HTMLInputElement, value: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    await act(async () => input.dispatchEvent(new Event('input', { bubbles: true })))
  }
  await change(minutes, '45'); await change(message, 'Saved writing')
  await act(async () => enabled.click())
  const form = message.closest('form')!
  await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(useSettingsStore.getState()).toMatchObject({ autoCommitEnabled: false, autoCommitMinutes: 45, autoCommitMessage: 'Saved writing' })
  await change(minutes, '0')
  await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(useSettingsStore.getState().autoCommitMinutes).toBe(45)
  expect(form.querySelector('[role="alert"]')).not.toBeNull()
})
