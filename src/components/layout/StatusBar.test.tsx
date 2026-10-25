import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { StatusBar } from './StatusBar'
import { useDocumentStore } from '../../stores/documentStore'
import { useLayoutStore } from '../../stores/layoutStore'
import { useSettingsStore } from '../../stores/settingsStore'

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)

afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks() })

async function mount() {
  HTMLDialogElement.prototype.showModal = vi.fn()
  HTMLDialogElement.prototype.close = vi.fn()
  useDocumentStore.getState().loadFromRaw('/a.md', 'One two three four five.')
  useLayoutStore.getState().setSheets('/a.md', 3)
  const container = document.createElement('div')
  document.body.append(container)
  await act(async () => createRoot(container).render(<StatusBar />))
  return container
}

it('shows the pages and words of the active document and opens Statistics from either', async () => {
  const container = await mount()
  const [pages, words] = [...container.querySelectorAll<HTMLButtonElement>('button')]
  expect(pages.textContent).toBe('Pages: 3')
  expect(words.textContent).toBe('Words: 5')
  await act(async () => pages.click())
  expect(document.querySelector('#statistics-title')?.textContent).toBe('Statistics')
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Close Statistics"]')!.click())
  expect(document.querySelector('#statistics-title')).toBeNull()
  await act(async () => words.click())
  expect(document.querySelector('#statistics-title')).not.toBeNull()
})

it('switches the page view and reflects the setting made elsewhere', async () => {
  useSettingsStore.getState().setViewMode('edit')
  const container = await mount()
  const single = container.querySelector<HTMLButtonElement>('[aria-label="Single page"]')!
  const spread = container.querySelector<HTMLButtonElement>('[aria-label="Spread"]')!
  expect(single.getAttribute('aria-pressed')).toBe('true')
  await act(async () => spread.click())
  expect(useSettingsStore.getState().viewMode).toBe('spreads')
  expect(spread.getAttribute('aria-pressed')).toBe('true')
  await act(async () => useSettingsStore.getState().setViewMode('edit'))
  expect(single.getAttribute('aria-pressed')).toBe('true')
})
