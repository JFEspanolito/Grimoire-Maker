import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { DocumentTabs } from './DocumentTabs'
import { useTabStore } from '../../stores/tabStore'
import { useSettingsStore } from '../../stores/settingsStore'

const openFile = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const closeTab = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('../../hooks/useFileSystem', () => ({ useFileSystem: () => ({ openFile, closeTab }) }))

it('translates tab controls into Spanish while keeping document names intact', async () => {
  const previous = useSettingsStore.getState().language
  useSettingsStore.setState({ language: 'es' })
  useTabStore.getState().reset('/book/My Chapter.md')
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    await act(async () => root.render(<DocumentTabs markdownViews={{}} onChangeView={() => {}} />))
    expect(container.querySelector('nav')?.getAttribute('aria-label')).toBe('Documentos abiertos')
    expect(container.querySelector('[aria-label="Cambiar vista de My Chapter"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="Cerrar My Chapter"]')).not.toBeNull()
    expect(container.querySelector('[title="Ver en modo Markdown"]')).not.toBeNull()
  } finally {
    await act(async () => root.unmount())
    useSettingsStore.setState({ language: previous })
    useTabStore.getState().reset(null)
  }
})

it('hides Markdown suffixes in tabs, tooltips and close labels without changing file actions', async () => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  const tabs = useTabStore.getState()
  tabs.reset('/book/Chapter.MD')
  tabs.open('/book/image.png', true)
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    await act(async () => root.render(<DocumentTabs markdownViews={{}} onChangeView={() => {}} />))
    expect(container.textContent).toContain('Chapter')
    expect(container.textContent).not.toContain('.MD')
    expect(container.textContent).toContain('image.png')
    expect(container.querySelector('[aria-label="Change view for image.png"]')).toBeNull()
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
