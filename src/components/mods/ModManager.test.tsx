import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { ModManager } from './ModManager'
import type { ModEntry } from '../../lib/modCatalog'
import { useModStore } from '../../stores/modStore'
import { importModFromPath, pickModSource } from '../../lib/modImport'
import { grantPluginConsent, listExternalPlugins, removeExternalPlugin } from '../../lib/externalPlugins'
import { activateExternalPlugin, setExternalKillSwitch, stopExternalPluginNow, useExternalRuntime, verifyIsolation } from '../../plugins/isolated/externalHost'

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

it('lists imported external plugins as unverified and waiting for approval, with no checkbox to enable them', async () => {
  const { container, button, details, close } = await openExternal({ current: null, state: 'installed' })
  const list = container.querySelector('[aria-label="External plugins"]')!
  expect(list.textContent).toContain('Community Zoom')
  expect(list.textContent).not.toContain('Imported')
  expect(list.textContent).toContain('Needs approval')
  expect(list.querySelector('input[type="checkbox"]')).toBeNull()
  expect(button('Activate external plugin Community Zoom')).toBeNull()
  // The removal lives inside Details, together with the technical facts.
  expect(button('Delete Community Zoom')).toBeNull()
  expect(list.textContent).not.toContain('ingerprint')
  await details('Community Zoom')
  expect(list.textContent).toContain('Someone (declared by the package, not verified)')
  expect(list.textContent).toContain('Read the zoom levelChange the zoom level')
  expect(list.textContent).not.toContain('editor:zoom:read')
  expect(list.textContent).toContain('Version fingerprint 0123456789ab')

  vi.mocked(listExternalPlugins).mockResolvedValue({ version: 1, disabledAll: false, plugins: {} })
  await act(async () => button('Delete Community Zoom')!.click())
  await wait()
  await act(async () => [...container.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find((item) => item.textContent === 'Delete')!.click())
  expect(stopExternalPluginNow).toHaveBeenCalledWith('community.zoom')
  expect(removeExternalPlugin).toHaveBeenCalledWith('community.zoom')
  expect(container.querySelector('[aria-label="External plugins"]')).toBeNull()
  await close()
})

it('shows what the plugin can do before approval and only grants and activates on confirm', async () => {
  const { container, button, close } = await openExternal({ current: null, state: 'installed' })
  await act(async () => button('Review and approve Community Zoom')!.click())
  const dialog = container.querySelector('[aria-labelledby="consent-community.zoom"]')!
  expect(dialog.textContent).toContain('Unverified')
  expect(dialog.textContent).toContain('Read the zoom level')
  expect(dialog.textContent).toContain('Set the editor zoom between 25% and 300%')
  expect(dialog.textContent).toContain('Fingerprint 0123456789ab')
  expect(grantPluginConsent).not.toHaveBeenCalled()

  await act(async () => [...dialog.querySelectorAll('button')].find((item) => item.textContent === 'Cancel')!.click())
  expect(grantPluginConsent).not.toHaveBeenCalled()
  expect(container.querySelector('[aria-labelledby="consent-community.zoom"]')).toBeNull()

  await act(async () => button('Review and approve Community Zoom')!.click())
  await act(async () => [...container.querySelectorAll('button')].find((item) => item.textContent === 'Approve and activate')!.click())
  expect(grantPluginConsent).toHaveBeenCalledWith(expect.objectContaining({
    id: 'community.zoom', version: '1.0.0', fingerprint: '0123456789abcdef', permissions: ['editor:zoom:read', 'editor:zoom:write'], sdkVersion: 1,
  }))
  expect(activateExternalPlugin).toHaveBeenCalledWith('community.zoom')
  await close()
})

it('activates an approved plugin, deactivates a running one, and offers nothing for altered files', async () => {
  const approved = await openExternal({ current: externalVersion.dir, state: 'installed' })
  await act(async () => approved.button('Activate external plugin Community Zoom')!.click())
  expect(activateExternalPlugin).toHaveBeenCalledWith('community.zoom')
  await approved.close()

  const active = await openExternal({ current: externalVersion.dir, state: 'active' })
  await act(async () => active.button('Deactivate external plugin Community Zoom')!.click())
  expect(stopExternalPluginNow).toHaveBeenCalledWith('community.zoom')
  await active.close()

  const altered = await openExternal({ current: null, state: 'altered' })
  expect(altered.container.textContent).toContain('Changed')
  await altered.details('Community Zoom')
  expect(altered.container.textContent).toContain('Files changed after installation')
  expect(altered.button('Review and approve Community Zoom')).toBeNull()
  expect(altered.button('Activate external plugin Community Zoom')).toBeNull()
  await altered.close()
})

it('the emergency switch disables every external plugin and blocks activation while on', async () => {
  const on = await openExternal({ current: externalVersion.dir, state: 'active' })
  await act(async () => on.button('Turn off all imported plugins')!.click())
  expect(setExternalKillSwitch).toHaveBeenCalledWith(true)
  await on.close()

  const off = await openExternal({ current: externalVersion.dir, state: 'installed' }, true)
  await off.details('Community Zoom')
  expect(off.container.textContent).toContain('All imported plugins are turned off.')
  expect(off.button('Activate external plugin Community Zoom')!.disabled).toBe(true)
  await act(async () => off.button('Allow imported plugins')!.click())
  expect(setExternalKillSwitch).toHaveBeenCalledWith(false)
  await off.close()
})

const localVersion = {
  ...externalVersion, source: 'local', localFolder: 'zoom', author: 'Grimoire Maker', name: 'Zoom', dir: '2.0.0-aaaaaaaaaaaa', version: '2.0.0',
}
const packageMod = (overrides: Partial<ModEntry> = {}): ModEntry => ({
  id: 'Plugins/zoom', kind: 'Plugins', label: 'zoom', folder: '/mods/Plugins/zoom', enabled: true, errors: [], package: true, ...overrides,
})

it('lists a package folder once, as a local card with its permissions and folder inside Details', async () => {
  const setEnabled = vi.fn(async () => {})
  const { container, button, details, close } = await openExternal({ current: localVersion.dir, state: 'active' }, false, localVersion, [packageMod()])
  useModStore.setState({ setEnabled })
  expect(container.querySelectorAll('[data-plugin-card]')).toHaveLength(1)
  expect(container.querySelector('[aria-label="External plugins"]')).toBeNull()
  expect(container.textContent).toContain('On')
  expect(outsideDetails(container)).not.toContain('/mods/Plugins/zoom')
  await details('Zoom')
  expect(container.textContent).toContain('Source Local package')
  expect(container.textContent).toContain('/mods/Plugins/zoom')
  expect(container.textContent).toContain('Read the zoom levelChange the zoom level')
  expect(container.textContent).not.toContain('editor:zoom:read')
  expect(button('Delete Zoom')).not.toBeNull()
  expect(button('Review and approve Zoom')).toBeNull()
  await act(async () => button('Enable zoom')!.click())
  expect(setEnabled).toHaveBeenCalledWith('Plugins/zoom', false)
  await close()
})

it('shows Off, Stopped and Error with the reason for a package folder', async () => {
  const off = await openExternal({ current: localVersion.dir, state: 'installed' }, false, localVersion, [packageMod({ enabled: false })])
  expect(off.container.querySelector('[data-plugin-card] [class*="status"]')?.textContent).toBe('Off')
  await off.close()

  const stopped = await openExternal({ current: localVersion.dir, state: 'stopped' }, false, localVersion, [packageMod()])
  expect(stopped.container.querySelector('[data-plugin-card] [class*="status"]')?.textContent).toBe('Stopped')
  await stopped.details('Zoom')
  expect(stopped.container.textContent).toContain('Turn it off and on to try again.')
  await stopped.close()

  const broken = await openExternal({ current: localVersion.dir, state: 'active' }, false, localVersion, [packageMod({ errors: ['manifest.json is not valid JSON'] })])
  expect(broken.container.querySelector('[data-plugin-card] [class*="status"]')?.textContent).toBe('Error')
  await broken.details('Zoom')
  expect(broken.container.textContent).toContain('manifest.json is not valid JSON')
  await broken.close()
})

const JARGON = /isolat|unverified|fingerprint|permissions requested/i
/** The text outside every opened Details panel: rows one to three of each card plus the tab chrome. */
const outsideDetails = (container: HTMLElement) => {
  const clone = container.cloneNode(true) as HTMLElement
  clone.querySelectorAll('[role="group"]').forEach((panel) => panel.remove())
  return clone.textContent ?? ''
}

it('keeps the plugin rows free of jargon and shows only one short intro line', async () => {
  const { container, close } = await openExternal({ current: null, state: 'installed' })
  const text = outsideDetails(container)
  expect(text).toContain('Plugins add extra tools to the editor.')
  expect(text).not.toMatch(JARGON)
  expect(text).not.toContain('Trusted local code')
  expect(container.querySelectorAll('[data-plugin-card]')).toHaveLength(1)
  const card = container.querySelector('[data-plugin-card]')!
  expect([...card.children].filter((child) => child.hasAttribute('data-row')).map((child) => child.getAttribute('data-row'))).toEqual(['1', '2'])
  await close()
})

it('shows the switch only when an imported plugin exists', async () => {
  const withImported = await openExternal({ current: externalVersion.dir, state: 'installed' })
  expect(withImported.button('Turn off all imported plugins')).toBeTruthy()
  await withImported.close()

  const onlyLocal = await openExternal({ current: localVersion.dir, state: 'active' }, false, localVersion, [packageMod()])
  expect(onlyLocal.button('Turn off all imported plugins')).toBeNull()
  expect(onlyLocal.button('Allow imported plugins')).toBeNull()
  await onlyLocal.close()
})

it('shows the safety banner only when the isolation check failed, and keeps the details behind a toggle', async () => {
  const quiet = await openExternal({ current: null, state: 'installed' })
  expect(quiet.container.querySelector('[role="alert"]')).toBeNull()
  await quiet.close()

  useExternalRuntime.setState({ isolation: { ok: false, summary: 'Frames could not be sandboxed.' } as never })
  const { container, close } = await openExternal({ current: null, state: 'installed' })
  const banner = container.querySelector('[role="alert"]')!
  expect(banner.textContent).toContain('Extra tools are switched off because the safety check did not pass on this computer.')
  expect(banner.textContent).not.toContain('Frames could not be sandboxed.')
  await act(async () => [...banner.querySelectorAll('button')].find((item) => item.textContent === 'Details')!.click())
  expect(banner.textContent).toContain('Frames could not be sandboxed.')
  await act(async () => [...banner.querySelectorAll('button')].find((item) => item.textContent === 'Run check again')!.click())
  expect(verifyIsolation).toHaveBeenCalledWith(true)
  await close()
  useExternalRuntime.setState({ isolation: null })
})

it('draws folder plugins with the same card: Bookmarks gets its official name and description, other folders the generic one', async () => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  const setEnabled = vi.fn(async () => {})
  useModStore.setState({
    busy: false, ready: true, errors: [], reload: vi.fn(async () => {}), setEnabled, missingOfficial: [],
    mods: [
      { id: 'Plugins/bookmarks', kind: 'Plugins', folder: '/mods/Plugins/bookmarks', label: 'bookmarks', enabled: true, errors: [] },
      { id: 'Plugins/mine', kind: 'Plugins', folder: '/mods/Plugins/mine', label: 'mine', enabled: false, errors: ['mine/bad.tsx: broken'] },
    ],
  })
  vi.mocked(listExternalPlugins).mockResolvedValue({ version: 1, disabledAll: false, plugins: {} })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(<ModManager onClose={() => {}} />))
  await act(async () => container.querySelector<HTMLButtonElement>('[role="tab"]:last-of-type')!.click())

  const cards = [...container.querySelectorAll('[data-plugin-card]')]
  expect(cards.map((card) => card.getAttribute('data-plugin-card'))).toEqual(['Bookmarks', 'mine'])
  expect(cards[0].textContent).not.toContain('Built in')
  expect(cards[0].textContent).toContain('Mark places in your book and jump back to them from anywhere in the project.')
  expect(cards[1].textContent).not.toContain('Local')
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Details of Bookmarks"]')!.click())
  expect(cards[0].textContent).toContain('Source Built in')
  expect(cards[1].textContent).toContain('Plugin from your Plugins folder.')
  expect(outsideDetails(container)).not.toContain('/mods/Plugins/bookmarks')
  expect(container.querySelector('input[type="checkbox"]')).toBeNull()

  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Enable bookmarks"]')!.click())
  expect(setEnabled).toHaveBeenCalledWith('Plugins/bookmarks', false)
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Enable mine"]')!.click())
  expect(setEnabled).toHaveBeenCalledWith('Plugins/mine', true)

  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Details of mine"]')!.click())
  expect(cards[1].textContent).toContain('Source Local')
  expect(cards[1].textContent).toContain('/mods/Plugins/mine')
  expect(cards[1].textContent).toContain('Runs with the same access as the app. Only keep plugins you trust.')
  expect(cards[1].textContent).toContain('mine/bad.tsx: broken')
  await act(async () => root.unmount())
  container.remove()
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
  expect(Array.from(container.querySelectorAll('[aria-label="Kind of mod"] [role="tab"]')).map((tab) => tab.textContent)).toEqual(['Themes', 'Snippets', 'Templates', 'Plugins'])
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

it('deletes a folder plugin after confirming: stops it, deletes through the store and shows a refusal plainly', async () => {
  const deleteMod = vi.fn(async () => {})
  const { container, details, close } = await openExternal({ current: localVersion.dir, state: 'active' }, false, localVersion, [packageMod()])
  useModStore.setState({ deleteMod })
  await details('Zoom')
  await act(async () => (await askDelete(container, 'Delete Zoom')).confirm.click())
  expect(stopExternalPluginNow).toHaveBeenCalledWith('community.zoom')
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

it('imported plugins use the existing removal path behind the same confirmation', async () => {
  const { container, details, close } = await openExternal({ current: null, state: 'installed' })
  await details('Community Zoom')
  const { cancel } = await askDelete(container, 'Delete Community Zoom')
  await act(async () => cancel.click())
  expect(removeExternalPlugin).not.toHaveBeenCalled()
  await act(async () => (await askDelete(container, 'Delete Community Zoom')).confirm.click())
  expect(removeExternalPlugin).toHaveBeenCalledExactlyOnceWith('community.zoom')
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
  useModStore.setState({ deleteMod })
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
