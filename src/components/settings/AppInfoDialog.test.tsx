import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import configSource from '../../../src-tauri/tauri.conf.json?raw'
import { AppInfoDialog } from './AppInfoDialog'

const config = JSON.parse(configSource) as { productName: string; version: string }
let root: Root
let container: HTMLDivElement
let trigger: HTMLButtonElement
const close = vi.fn()
const originalShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal')
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close')
beforeEach(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value(this: HTMLDialogElement) { this.open = true } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value(this: HTMLDialogElement) { this.open = false } })
  trigger = document.createElement('button')
  container = document.createElement('div')
  document.body.append(trigger, container)
  trigger.focus()
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  trigger.remove(); container.remove(); vi.clearAllMocks()
  if (originalShow) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', originalShow)
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
  if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, 'close', originalClose)
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close')
})

it('uses application identity, contact, and an accessible GitHub icon link without loading credits', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch')
  try {
    await act(async () => root.render(<AppInfoDialog kind="about" onClose={close} />))
    expect(container.querySelector('dialog')?.open).toBe(true)
    expect(container.textContent).toContain(config.productName)
    expect(container.textContent).toContain(`Version ${config.version}`)
    expect(container.querySelector('a[href="mailto:apps@jfespanolito.dev"]')?.textContent).toBe('apps@jfespanolito.dev')
    const github = container.querySelector<HTMLAnchorElement>('[aria-label="Grimoire Maker on GitHub"]')!
    expect(github.href).toBe('https://github.com/JFEspanolito/Grimoire-Maker')
    expect(github.target).toBe('_blank')
    expect(github.rel).toBe('noopener noreferrer')
    expect(github.querySelector('svg')).not.toBeNull()
    expect(container.querySelector<HTMLButtonElement>('[data-credits]')?.disabled).toBe(true)
    expect(container.querySelector('[data-credits]')?.getAttribute('title')).toContain('https://github.com/JFEspanolito/Grimoire-Maker/Contributors')
    expect(fetch).not.toHaveBeenCalled()
  } finally { fetch.mockRestore() }
})

it('shows the English tutorial placeholder and supports Escape, X, Close, and focus restoration', async () => {
  await act(async () => root.render(<AppInfoDialog kind="tutorial" onClose={close} />))
  expect(container.textContent).toContain('In development')
  expect(container.textContent).not.toContain('En desarrollo')
  expect(container.querySelector('dialog')?.getAttribute('aria-labelledby')).toBe('app-info-title')
  const cancel = new Event('cancel', { cancelable: true })
  await act(async () => container.querySelector('dialog')!.dispatchEvent(cancel))
  expect(cancel.defaultPrevented).toBe(true)
  expect(close).toHaveBeenCalledTimes(1)
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Close Tutorial"]')!.click())
  await act(async () => Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Close')!.click())
  expect(close).toHaveBeenCalledTimes(3)
  await act(async () => root.unmount())
  expect(document.activeElement).toBe(trigger)
})
