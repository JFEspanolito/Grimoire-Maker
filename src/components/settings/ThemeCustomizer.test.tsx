import { act } from 'react'

import { createRoot, type Root } from 'react-dom/client'

import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { ThemeCustomizer } from './ThemeCustomizer'

import { useSettingsStore } from '../../stores/settingsStore'



const mocks = vi.hoisted(() => ({ importImage: vi.fn(), load: vi.fn(), save: vi.fn(), reload: vi.fn(), users: [] as { id: string; name: string; builtin: boolean }[] }))

vi.mock('../../lib/themeEditor', async (original) => ({ ...await original<typeof import('../../lib/themeEditor')>(), loadThemeDraft: mocks.load, saveThemeDraft: mocks.save }))

vi.mock('../../stores/themeStore', () => ({ useThemeStore: Object.assign(() => ({

  themes: [{ id: 'parchment', name: 'Parchment', builtin: true }], userThemes: [],

}), { getState: () => ({ reload: mocks.reload, userThemes: mocks.users, errors: [] }) }) }))

vi.mock('../../lib/importThemeDecoration', () => ({ importThemeDecoration: mocks.importImage }))

vi.mock('../../hooks/useFileSystem', () => ({ isTauri: () => true }))

let root: Root

let container: HTMLDivElement

const close = vi.fn()

beforeEach(async () => {

  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)

  mocks.users = []

  mocks.load.mockResolvedValue({ theme: { id: 'parchment', name: 'Parchment', builtin: true }, css: "[data-theme='parchment'] { --page-bg: #123456; }", path: null, directory: '/themes' })

  mocks.save.mockResolvedValue({ id: 'parchment-copy', name: 'Parchment Copy', builtin: false })

  mocks.reload.mockResolvedValue(undefined)

  useSettingsStore.getState().setTheme('parchment')

  container = document.createElement('div')

  root = createRoot(container)

  await act(async () => root.render(<ThemeCustomizer onClose={close} />))

})

afterEach(async () => { await act(async () => root.unmount()); vi.clearAllMocks() })



it('provides isolated preview and individual colors without changing the active theme', () => {

  for (const name of ['Background', 'Text', 'H1', 'H2', 'H3', 'Divider']) expect(container.querySelector(`input[aria-label="${name}"]`)).not.toBeNull()

  expect(container.querySelector('dialog')).toBeNull()

  expect(container.querySelector('iframe')?.getAttribute('sandbox')).toBe('')

  expect(container.querySelector('iframe')?.srcdoc).toContain('default-src')

  expect(container.querySelector('iframe')?.srcdoc).toContain('border-color: #9c2b1a')

  expect(useSettingsStore.getState().theme).toBe('parchment')

})



it('updates the isolated sample when a color changes and cancels without saving', async () => {

  const color = container.querySelector<HTMLInputElement>('[aria-label="H2"]')!

  await act(async () => {

    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(color, '#abcdef')

    color.dispatchEvent(new Event('input', { bubbles: true }))

  })

  expect(container.querySelector('iframe')?.srcdoc).toContain('color: #abcdef')

  expect(useSettingsStore.getState().theme).toBe('parchment')

  await act(async () => Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Cancel')!.click())

  expect(mocks.save).not.toHaveBeenCalled()

  expect(close).toHaveBeenCalledOnce()

})



it('locks close controls while saving and notifies the host dialog', async () => {

  let finish!: (value: { id: string; name: string; builtin: boolean }) => void

  const busy = vi.fn()

  await act(async () => root.render(<ThemeCustomizer onClose={close} onBusyChange={busy} />))

  mocks.save.mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))

  await act(async () => container.querySelector<HTMLButtonElement>('[data-action="save"]')!.click())

  expect(busy).toHaveBeenLastCalledWith(true)

  expect(Array.from(container.querySelectorAll('button')).every((button) => button.disabled)).toBe(true)

  await act(async () => finish({ id: 'parchment-copy', name: 'Copy', builtin: false }))

  expect(busy).toHaveBeenLastCalledWith(false)

})



it('offers separate Save and Save As operations for user-owned themes', async () => {

  await act(async () => root.unmount())

  mocks.load.mockResolvedValueOnce({ theme: { id: 'custom', name: 'Custom', builtin: false }, css: "[data-theme='custom'] {}", path: '/themes/custom.css', directory: '/themes' })

  root = createRoot(container)

  await act(async () => root.render(<ThemeCustomizer onClose={close} />))

  await act(async () => container.querySelector<HTMLButtonElement>('[data-action="save"]')!.click())

  expect(mocks.save).toHaveBeenLastCalledWith(expect.anything(), 'Parchment', expect.anything(), false, ['parchment'], [], expect.any(Object))

  await act(async () => Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Save As')!.click())

  expect(mocks.save).toHaveBeenLastCalledWith(expect.anything(), 'Parchment', expect.anything(), true, ['parchment'], [], expect.any(Object))

})



it('saves a built-in copy, verifies discovery, and selects through settings', async () => {

  mocks.users = [{ id: 'parchment-copy', name: 'Parchment Copy', builtin: false }]

  await act(async () => container.querySelector<HTMLButtonElement>('[data-action="save"]')!.click())

  expect(mocks.save).toHaveBeenCalledWith(expect.anything(), 'Parchment Copy', expect.anything(), true, ['parchment'], [], expect.any(Object))

  expect(mocks.reload).toHaveBeenCalledOnce()

  expect(useSettingsStore.getState().theme).toBe('parchment-copy')

  expect(close).toHaveBeenCalledOnce()

})



it('does not select an undiscovered saved theme or close on save failure', async () => {

  await act(async () => container.querySelector<HTMLButtonElement>('[data-action="save"]')!.click())

  expect(container.querySelector('[role="alert"]')?.textContent).toContain('could not be reloaded')

  expect(useSettingsStore.getState().theme).toBe('parchment')

  expect(close).not.toHaveBeenCalled()

  mocks.save.mockRejectedValueOnce(new Error('Access denied'))

  await act(async () => container.querySelector<HTMLButtonElement>('[data-action="save"]')!.click())

  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Access denied')

})



it('imports background artwork, exposes placement controls and saves portable image metadata', async () => {

  const image = { id: 'flowers', name: 'Flowers', dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM/8AAAAASUVORK5CYII=', widthMm: 40, heightMm: 40, xMm: 5, yMm: 5, anchor: 'header' }

  mocks.importImage.mockResolvedValueOnce(image)

  await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Import image…')!.click())

  expect(container.querySelector('[aria-label="Move background Flowers"]')).not.toBeNull()

  const anchor = container.querySelector<HTMLSelectElement>('[aria-label="Background anchor"]')!

  await act(async () => { anchor.value = 'footer'; anchor.dispatchEvent(new Event('change', { bubbles: true })) })

  mocks.users = [{ id: 'parchment-copy', name: 'Parchment Copy', builtin: false }]

  await act(async () => container.querySelector<HTMLButtonElement>('[data-action="save"]')!.click())

  expect(mocks.save.mock.calls.at(-1)?.[5]).toEqual([{ ...image, anchor: 'footer' }])

})



it('provides four theme sections and saves header/footer fields across navigation', async () => {

  const tabs = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'))

  expect(tabs.map(tab => tab.textContent)).toEqual(['Theme name', 'Colors', 'Backgrounds', 'Header and footer'])

  await act(async () => tabs[3].click())

  const field = container.querySelector<HTMLInputElement>('[aria-label="Footer right"]')!

  await act(async () => {

    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, '{author} · {page}/{pages}')

    field.dispatchEvent(new Event('input', { bubbles: true }))

  })

  await act(async () => tabs[1].click())

  await act(async () => tabs[3].click())

  expect(field.value).toBe('{author} · {page}/{pages}')

  await act(async () => container.querySelector<HTMLButtonElement>('[data-action="save"]')!.click())

  expect(mocks.save.mock.calls.at(-1)?.[6].footer.right).toBe('{author} · {page}/{pages}')

})


it('previews header and footer live on a page without saving', async () => {
  await act(async () => container.querySelector<HTMLButtonElement>('#theme-tab-3')!.click())
  const preview = container.querySelector<HTMLElement>('[aria-label="Header and footer page preview"]')
  expect(preview).not.toBeNull()
  const field = container.querySelector<HTMLInputElement>('[aria-label="Footer right"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, '{author} - {page}/{pages}')
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(preview!.textContent).toContain('Sample Author - 1/10')
  expect(preview!.style.aspectRatio).not.toBe('')
  expect(mocks.save).not.toHaveBeenCalled()
})
