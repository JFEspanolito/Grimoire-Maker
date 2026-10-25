import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { ModManager } from './ModManager'
import { useModStore } from '../../stores/modStore'
import { importModFromPath, pickModSource } from '../../lib/modImport'

vi.mock('../../hooks/useFileSystem', () => ({ isTauri: () => true }))
vi.mock('../../lib/modImport', () => ({
  pickModSource: vi.fn(async () => '/downloads/my-theme.zip'),
  importModFromPath: vi.fn(async () => 'my-theme'),
}))

const initial = useModStore.getState()
beforeAll(() => {
  // jsdom has no native dialog implementation; native focus trapping needs desktop verification.
  HTMLDialogElement.prototype.showModal = function () { this.open = true }
  HTMLDialogElement.prototype.close = function () { this.open = false }
})
afterEach(() => { useModStore.setState(initial); vi.clearAllMocks() })

it('renders two-column category navigation, toggles mods, opens Content folders, and imports mods with refresh', async () => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  const toggle = vi.fn(async () => {})
  const reload = vi.fn(async () => {})
  const close = vi.fn()
  const editPaths = vi.fn()
  useModStore.setState({
    root: '/config/Mods',
    busy: false,
    ready: true,
    errors: [],
    reload,
    setEnabled: toggle,
    mods: [
      { id: 'Snippets/dnd', kind: 'Snippets', folder: '/config/Mods/Snippets/dnd', label: 'D&D', enabled: true, errors: [] },
      { id: 'Templates/zine', kind: 'Templates', folder: '/config/Mods/Templates/zine', label: 'A5 Zine', enabled: true, errors: [] },
      { id: 'Themes/arcane', kind: 'Themes', folder: '/config/themes/arcane.css', label: 'Arcane Ink', enabled: true, errors: [] },
      { id: 'Plugins/pixel-ruler', kind: 'Plugins', folder: '/config/Mods/Plugins/pixel-ruler', label: 'Ruler', enabled: true, errors: [] },
      { id: 'Plugins/zoom', kind: 'Plugins', folder: '/config/Mods/Plugins/zoom', label: 'Zoom', enabled: true, errors: [] },
    ],
  })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(<ModManager onClose={close} onEditPaths={editPaths} />))
  expect(reload).toHaveBeenCalledOnce()
  expect(container.querySelector('dialog')?.open).toBe(true)

  const buttons = Array.from(container.querySelectorAll('button'))
  const createBtn = buttons.find((b) => b.textContent === 'Create Mod')
  expect(createBtn?.disabled).toBe(true)

  // Default tab is Snippets
  await act(async () => container.querySelector<HTMLInputElement>('[aria-label="Enable D&D"]')?.click())
  expect(toggle).toHaveBeenCalledWith('Snippets/dnd', false)

  // Switch to Themes tab in Col 1
  const themesTab = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
    .find((tab) => tab.textContent?.startsWith('Themes'))
  await act(async () => themesTab?.click())
  expect(container.querySelector('[aria-label="Enable Arcane Ink"]')).toBeTruthy()

  // Switch to Plugins tab in Col 1 and toggle Ruler and Zoom
  const pluginsTab = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
    .find((tab) => tab.textContent?.startsWith('Plugins'))
  await act(async () => pluginsTab?.click())
  expect(container.querySelector('[aria-label="Enable Ruler"]')).toBeTruthy()
  expect(container.querySelector('[aria-label="Enable Zoom"]')).toBeTruthy()
  await act(async () => container.querySelector<HTMLInputElement>('[aria-label="Enable Zoom"]')?.click())
  expect(toggle).toHaveBeenCalledWith('Plugins/zoom', false)
  await act(async () => themesTab?.click())

  // Edit Mods Path opens Settings -> Preferences -> Content folders
  const editPathsBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Edit Mods Path')
  await act(async () => editPathsBtn?.click())
  expect(editPaths).toHaveBeenCalledOnce()

  // Import Mod modal
  const importBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Import Mod')
  await act(async () => importBtn?.click())
  expect(container.querySelector('#import-mod-title')?.textContent).toBe('Import Mod')

  const confirmImportBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Import')
  await act(async () => confirmImportBtn?.click())
  expect(pickModSource).toHaveBeenCalledWith('zip', 'Themes')
  expect(importModFromPath).toHaveBeenCalledWith('/downloads/my-theme.zip', 'zip', 'Themes')
  expect(reload).toHaveBeenCalledTimes(2)

  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Close Mod Manager"]')?.click())
  expect(close).toHaveBeenCalledOnce()
  await act(async () => root.unmount())
  container.remove()
})

it('offers to install official plugins that are missing and restores the chosen one', async () => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  const installOfficial = vi.fn(async () => {})
  useModStore.setState({
    busy: false, ready: true, errors: [], reload: vi.fn(async () => {}), installOfficial, mods: [],
    missingOfficial: [{ folder: 'bookmarks', label: 'Bookmarks', files: {} }],
  })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(<ModManager onClose={() => {}} />))
  expect(container.querySelector('[aria-label="Install official plugin Bookmarks"]')).toBeNull()
  await act(async () => container.querySelector<HTMLButtonElement>('[role="tab"]:last-of-type')!.click())
  const install = container.querySelector<HTMLButtonElement>('[aria-label="Install official plugin Bookmarks"]')!
  expect(install.textContent).toBe('Install official plugin')
  await act(async () => install.click())
  expect(installOfficial).toHaveBeenCalledWith('bookmarks')
  await act(async () => root.unmount())
})
