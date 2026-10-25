import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import configSource from '../../../src-tauri/tauri.conf.json?raw'
import packageSource from '../../../package.json?raw'
import { AppInfoDialog, TUTORIAL_STEPS } from './AppInfoDialog'

const config = { ...(JSON.parse(configSource) as { productName: string }), ...(JSON.parse(packageSource) as { version: string }) }
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

it('runs the 6-step spotlight tutorial with Next, Back, Skip Tour, X, Escape, and focus restoration', async () => {
  const sidebar = document.createElement('aside')
  sidebar.setAttribute('data-tour', 'project-sidebar')
  vi.spyOn(sidebar, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 40, 260, 600))
  document.body.append(sidebar)
  try {
    await act(async () => root.render(<AppInfoDialog kind="tutorial" onClose={close} />))
    expect(TUTORIAL_STEPS).toHaveLength(6)
    expect(container.textContent).toContain('Step 1 of 6')
    expect(container.textContent).toContain('Project Files, Templates & Git')
    expect(container.querySelector('[data-tour-spotlight]')).not.toBeNull()

    const next = () => Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Next')!
    await act(async () => next().click())
    expect(container.textContent).toContain('Step 2 of 6')
    expect(container.textContent).toContain('Tabs, Split View & Page Editor')

    const back = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Back')!
    await act(async () => back.click())
    expect(container.textContent).toContain('Step 1 of 6')

    for (let i = 0; i < 5; i++) {
      await act(async () => next().click())
    }
    expect(container.textContent).toContain('Step 6 of 6')
    expect(container.textContent).toContain('Themes, Mods & Export PDF')
    const finish = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Finish')!
    await act(async () => finish.click())
    expect(close).toHaveBeenCalledTimes(1)

    const cancel = new Event('cancel', { cancelable: true })
    await act(async () => container.querySelector('dialog')!.dispatchEvent(cancel))
    expect(cancel.defaultPrevented).toBe(true)
    expect(close).toHaveBeenCalledTimes(2)

    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Close Tutorial"]')!.click())
    await act(async () => Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Skip Tour')!.click())
    expect(close).toHaveBeenCalledTimes(4)
    await act(async () => root.unmount())
    expect(document.activeElement).toBe(trigger)
  } finally {
    sidebar.remove()
  }
})
