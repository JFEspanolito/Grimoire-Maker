import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { ModManager } from './ModManager'
import type { ModEntry } from '../../lib/modCatalog'
import { useModStore } from '../../stores/modStore'
import { importModFromPath, pickModSource } from '../../lib/modImport'
import { grantPluginConsent, listExternalPlugins } from '../../lib/externalPlugins'
import { activateExternalPlugin, stopExternalPluginNow } from '../../plugins/isolated/externalHost'

vi.mock('../../hooks/useFileSystem', () => ({ isTauri: () => true }))
vi.mock('../../lib/modExport', () => ({ exportTheme: vi.fn(), exportSnippet: vi.fn(), exportSnippetPackFrom: vi.fn(), exportProjectAsTemplate: vi.fn() }))
vi.mock('../../lib/snippetLibrary', () => ({ saveSnippetToLibrary: vi.fn() }))
vi.mock('../../lib/modImport', () => ({
  pickModSource: vi.fn(async () => '/downloads/my-theme.zip'),
  importModFromPath: vi.fn(async () => 'my-theme'),
}))

vi.mock('../../lib/externalPlugins', async (original) => ({
  ...(await original<typeof import('../../lib/externalPlugins')>()),
  listExternalPlugins: vi.fn(async () => ({ version: 1, disabledAll: false, plugins: {} })),
  removeExternalPlugin: vi.fn(async () => {}),
  grantPluginConsent: vi.fn(async () => {}),
}))
vi.mock('../../plugins/isolated/externalHost', async (original) => ({
  ...(await original<typeof import('../../plugins/isolated/externalHost')>()),
  activateExternalPlugin: vi.fn(async () => {}),
  stopExternalPluginNow: vi.fn(async () => {}),
  setExternalKillSwitch: vi.fn(async () => {}),
  verifyIsolation: vi.fn(async () => ({ ok: true })),
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
  expect(createBtn?.disabled).toBe(false)

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
  expect(install.textContent).toBe('Install')
  await act(async () => install.click())
  expect(installOfficial).toHaveBeenCalledWith('bookmarks')
  await act(async () => root.unmount())
})

const externalVersion = {
  dir: '1.0.0-0123456789ab', version: '1.0.0', fingerprint: '0123456789abcdef', name: 'Community Zoom', author: 'Someone',
  description: 'Zoom controls.', permissions: ['editor:zoom:read', 'editor:zoom:write'], granted: [], sdkVersion: 1, consentAt: null,
  installedAt: 1, source: 'import', signature: null,
}

async function openExternal(record: { current: string | null; state: string }, disabledAll = false, version = externalVersion, mods: ModEntry[] = []) {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  vi.mocked(listExternalPlugins).mockResolvedValue({
    version: 1, disabledAll,
    plugins: { 'community.zoom': { latest: version.dir, ...record, versions: [version] } },
  })
  useModStore.setState({ busy: false, ready: true, errors: [], reload: vi.fn(async () => {}), mods, missingOfficial: [] })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(<ModManager onClose={() => {}} />))
  await act(async () => container.querySelector<HTMLButtonElement>('[role="tab"]:last-of-type')!.click())
  const details = async (name: string) => {
    const toggle = container.querySelector<HTMLButtonElement>(`[aria-label="Details of ${name}"]`)!
    if (toggle.getAttribute('aria-expanded') !== 'true') await act(async () => toggle.click())
  }
  const button = (label: string) => container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`) ?? [...container.querySelectorAll('button')].find((item) => item.textContent === label) ?? null
  return { container, button, details, close: () => act(async () => root.unmount()) }
}

it('supports only official plugin controls and never queries or activates external packages', async () => {
  const { container, button, close } = await openExternal({ current: externalVersion.dir, state: 'active' }, false, externalVersion, [
    packageMod(),
    { id: 'Plugins/mine', kind: 'Plugins', folder: '/mods/Plugins/mine', label: 'mine', enabled: true, errors: [] },
  ])
  expect(container.textContent).toContain('Only shipped official plugins are supported.')
  expect(container.querySelector('[aria-label="External plugins"]')).toBeNull()
  expect(container.querySelectorAll('[data-plugin-card]')).toHaveLength(1)
  expect(button('Enable zoom')).toBeTruthy()
  expect(button('Enable mine')).toBeNull()
  expect(button('Import Mod')).toBeNull()
  expect(button('Create Mod')).toBeNull()
  expect(listExternalPlugins).not.toHaveBeenCalled()
  expect(activateExternalPlugin).not.toHaveBeenCalled()
  expect(grantPluginConsent).not.toHaveBeenCalled()
  await close()
})

it('offers only declarative kinds in the import selector', async () => {
  const { container, button, close } = await openExternal({ current: null, state: 'installed' })
  await act(async () => container.querySelector<HTMLButtonElement>('[role="tab"]')!.click())
  await act(async () => button('Import Mod')!.click())
  expect([...container.querySelectorAll<HTMLSelectElement>('[aria-label="Mod type"] option')].map((option) => option.value)).toEqual(['Snippets', 'Templates', 'Themes'])
  await close()
})

const localVersion = { ...externalVersion, source: 'local', localFolder: 'zoom', name: 'Zoom' }
const packageMod = (overrides: Partial<ModEntry> = {}): ModEntry => ({
  id: 'Plugins/zoom', kind: 'Plugins', label: 'zoom', folder: '/mods/Plugins/zoom', enabled: true, errors: [], package: true, ...overrides,
})

it('opens Create Mod from its button and hands the Theme Customizer request to the host', async () => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  useModStore.setState({ busy: false, ready: true, errors: [], reload: vi.fn(async () => {}), mods: [] })
  const openCustomizer = vi.fn()
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(<ModManager onClose={() => {}} onOpenThemeCustomizer={openCustomizer} />))
  expect(container.querySelector('#create-mod-title')).toBeNull()
  const open = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Create Mod')!
  await act(async () => open.click())
  expect(container.querySelector('#create-mod-title')?.textContent).toBe('Create Mod')
  expect(Array.from(container.querySelectorAll('[aria-label="Kind of mod"] [role="tab"]')).map((tab) => tab.textContent)).toEqual(['Themes', 'Snippets', 'Templates'])
  // The Mod Manager category (Snippets) decides the starting tab.
  expect(container.querySelector('#create-mod-tab-Snippets')?.getAttribute('aria-selected')).toBe('true')
  await act(async () => container.querySelector<HTMLButtonElement>('#create-mod-tab-Themes')!.click())
  const customizer = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Open Theme Customizer')!
  await act(async () => customizer.click())
  expect(openCustomizer).toHaveBeenCalledOnce()
  expect(container.querySelector('#create-mod-title')).toBeNull()
  await act(async () => root.unmount())
  container.remove()
})

/** The dialog's buttons ignore clicks for a moment after it opens (a double-click must not delete). */
const wait = (ms = 350) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) })

/** Opens the confirmation for a Delete button, waits until its buttons react, and returns the dialog and its buttons. */
async function askDelete(container: HTMLElement, label: string) {
  await act(async () => container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click())
  await wait()
  const dialog = container.querySelector<HTMLElement>('[role="alertdialog"]')!
  const inDialog = (text: string) => [...dialog.querySelectorAll('button')].find((item) => item.textContent === text)!
  return { dialog, cancel: inDialog('Cancel'), confirm: inDialog('Delete') }
}

it('never deletes a folder plugin without confirming; Cancel is focused and cancelling does nothing', async () => {
  const deleteMod = vi.fn(async () => {})
  const { container, details, close } = await openExternal({ current: localVersion.dir, state: 'active' }, false, localVersion, [packageMod()])
  useModStore.setState({ deleteMod })
  expect(container.querySelector('[aria-label="Delete Zoom"]')).toBeNull()
  await details('Zoom')
  const { dialog, cancel } = await askDelete(container, 'Delete Zoom')
  expect(document.activeElement).toBe(cancel)
  expect(dialog.getAttribute('aria-modal')).toBe('true')
  expect(dialog.textContent).toContain('deleted permanently')
  expect(dialog.textContent).toContain('cannot be recovered')
  expect(dialog.textContent).toContain('install it again')
  await act(async () => cancel.click())
  expect(container.querySelector('[role="alertdialog"]')).toBeNull()
  expect(deleteMod).not.toHaveBeenCalled()
  expect(stopExternalPluginNow).not.toHaveBeenCalled()
  await close()
})

it('deletes an official plugin after confirming through the store and shows a refusal plainly', async () => {
  const deleteMod = vi.fn(async () => {})
  const { container, details, close } = await openExternal({ current: localVersion.dir, state: 'active' }, false, localVersion, [packageMod()])
  useModStore.setState({ deleteMod })
  await details('Zoom')
  await act(async () => (await askDelete(container, 'Delete Zoom')).confirm.click())
  expect(stopExternalPluginNow).not.toHaveBeenCalled()
  expect(deleteMod).toHaveBeenCalledExactlyOnceWith('Plugins/zoom')
  expect(container.querySelector('[role="alertdialog"]')).toBeNull()

  deleteMod.mockRejectedValueOnce(new Error('That mod is a link, so it was not deleted.'))
  await act(async () => (await askDelete(container, 'Delete Zoom')).confirm.click())
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('That mod is a link, so it was not deleted.')
  await close()
})

it('closes the confirmation with Escape without deleting', async () => {
  const deleteMod = vi.fn(async () => {})
  const { container, details, close } = await openExternal({ current: localVersion.dir, state: 'active' }, false, localVersion, [packageMod()])
  useModStore.setState({ deleteMod })
  await details('Zoom')
  const { cancel } = await askDelete(container, 'Delete Zoom')
  await act(async () => { cancel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
  expect(container.querySelector('[role="alertdialog"]')).toBeNull()
  expect(deleteMod).not.toHaveBeenCalled()
  await close()
})

it.each([
  ['Snippets', 'Snippets/dnd', 'D&D'],
  ['Templates', 'Templates/zine', 'A5 Zine'],
  ['Themes', 'Themes/arcane', 'Arcane Ink'],
])('deletes a %s row only after confirming, and a cancel leaves it alone', async (kind, id, label) => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  const deleteMod = vi.fn(async () => {})
  useModStore.setState({
    busy: false, ready: true, errors: [], reload: vi.fn(async () => {}), deleteMod, missingOfficial: [],
    mods: [{ id, kind: kind as ModEntry['kind'], folder: `/config/${kind}/x`, label, enabled: true, errors: [] }],
  })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(<ModManager onClose={() => {}} />))
  await act(async () => [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((tab) => tab.textContent?.startsWith(kind))!.click())
  // The toggle stays, the Delete button sits next to it and is not nested in the toggle label.
  expect(container.querySelector(`[aria-label="Enable ${label}"]`)).toBeTruthy()
  expect(container.querySelector(`label [aria-label="Delete ${label}"]`)).toBeNull()
  const first = await askDelete(container, `Delete ${label}`)
  await act(async () => first.cancel.click())
  expect(deleteMod).not.toHaveBeenCalled()
  await act(async () => (await askDelete(container, `Delete ${label}`)).confirm.click())
  expect(deleteMod).toHaveBeenCalledExactlyOnceWith(id)
  await act(async () => root.unmount())
  container.remove()
})

it('ignores clicks on the confirmation buttons for 300 ms after it opens, then reacts', async () => {
  const deleteMod = vi.fn(async () => {})
  const { container, details, close } = await openExternal({ current: localVersion.dir, state: 'active' }, false, localVersion, [packageMod()])
  await act(async () => useModStore.setState({ deleteMod }))
  await details('Zoom')
  vi.useFakeTimers()
  try {
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Delete Zoom"]')!.click())
    const buttons = () => [...container.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')]
    // The second click of a double-click lands on the dialog's Delete button.
    await act(async () => buttons().find((item) => item.textContent === 'Delete')!.click())
    await act(async () => buttons().find((item) => item.textContent === 'Cancel')!.click())
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull()
    expect(deleteMod).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(301) })
    await act(async () => buttons().find((item) => item.textContent === 'Delete')!.click())
    expect(container.querySelector('[role="alertdialog"]')).toBeNull()
  } finally {
    vi.useRealTimers()
  }
  expect(deleteMod).toHaveBeenCalledOnce()
  await close()
})
