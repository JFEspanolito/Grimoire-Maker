import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { ModManager } from './ModManager'
import type { ModEntry } from '../../lib/modCatalog'
import { useModStore } from '../../stores/modStore'
import { importModFromPath, pickModSource } from '../../lib/modImport'
import { grantPluginConsent, listExternalPlugins, removeExternalPlugin } from '../../lib/externalPlugins'
import { activateExternalPlugin, setExternalKillSwitch, stopExternalPluginNow } from '../../plugins/isolated/externalHost'

vi.mock('../../hooks/useFileSystem', () => ({ isTauri: () => true }))
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
  const button = (label: string) => container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`) ?? [...container.querySelectorAll('button')].find((item) => item.textContent === label) ?? null
  return { container, button, close: () => act(async () => root.unmount()) }
}

it('lists imported external plugins as unverified and waiting for approval, with no checkbox to enable them', async () => {
  const { container, button, close } = await openExternal({ current: null, state: 'installed' })
  const list = container.querySelector('[aria-label="External plugins"]')!
  expect(list.textContent).toContain('Community Zoom')
  expect(list.textContent).toContain('by Someone (declared, not verified)')
  expect(list.textContent).toContain('Permissions requested: editor:zoom:read, editor:zoom:write')
  expect(list.textContent).toContain('Unverified · Isolated plugin · Needs your approval')
  expect(list.querySelector('input[type="checkbox"]')).toBeNull()
  expect(button('Activate external plugin Community Zoom')).toBeNull()

  vi.mocked(listExternalPlugins).mockResolvedValue({ version: 1, disabledAll: false, plugins: {} })
  await act(async () => button('Remove external plugin Community Zoom')!.click())
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
  expect(altered.container.textContent).toContain('Files changed after installation')
  expect(altered.button('Review and approve Community Zoom')).toBeNull()
  expect(altered.button('Activate external plugin Community Zoom')).toBeNull()
  await altered.close()
})

it('the emergency switch disables every external plugin and blocks activation while on', async () => {
  const on = await openExternal({ current: externalVersion.dir, state: 'active' })
  await act(async () => on.button('Disable all external plugins')!.click())
  expect(setExternalKillSwitch).toHaveBeenCalledWith(true)
  await on.close()

  const off = await openExternal({ current: externalVersion.dir, state: 'installed' }, true)
  expect(off.container.textContent).toContain('All external plugins are switched off')
  expect(off.button('Activate external plugin Community Zoom')!.disabled).toBe(true)
  await act(async () => off.button('Allow external plugins')!.click())
  expect(setExternalKillSwitch).toHaveBeenCalledWith(false)
  await off.close()
})

const bundledVersion = { ...externalVersion, source: 'bundled', author: 'Grimoire Maker', name: 'Zoom', dir: '2.0.0-aaaaaaaaaaaa', version: '2.0.0' }

it('shows a bundled plugin as part of the app: no approval, no removal, spared by the emergency switch', async () => {
  const { container, button, close } = await openExternal({ current: bundledVersion.dir, state: 'active' }, true, bundledVersion)
  expect(container.textContent).toContain('Bundled with the app · Isolated plugin')
  expect(container.textContent).not.toContain('declared, not verified')
  expect(button('Remove external plugin Zoom')).toBeNull()
  expect(button('Review and approve Zoom')).toBeNull()
  expect(button('Deactivate external plugin Zoom')!.disabled).toBe(false)
  await close()
})

it('explains that an edited local copy is used instead of the bundled plugin', async () => {
  useModStore.setState({ localWins: ['community.zoom'] })
  const { container, button, close } = await openExternal({ current: bundledVersion.dir, state: 'installed' }, false, bundledVersion)
  expect(container.textContent).toContain('Off: your edited local copy is in use instead')
  expect(button('Activate external plugin Zoom')!.disabled).toBe(true)
  await close()
  useModStore.setState({ localWins: [] })
})

it('lists a replaced trusted folder once, on the bundled card, instead of as a second row', async () => {
  const replaced: ModEntry = { id: 'Plugins/zoom', kind: 'Plugins', label: 'zoom', folder: '/mods/Plugins/zoom', enabled: false, errors: [], replacedBy: 'community.zoom' }
  const { container, close } = await openExternal({ current: bundledVersion.dir, state: 'active' }, false, bundledVersion, [replaced])
  expect(container.textContent).toContain('Your older copy in Plugins/zoom is kept on disk but not loaded')
  expect(container.querySelector('input[aria-label="Enable zoom"]')).toBeNull()
  expect(container.textContent).not.toContain('/mods/Plugins/zoom')
  await close()
})
