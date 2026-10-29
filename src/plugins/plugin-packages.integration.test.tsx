import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'
import type { ModEntry, ModFs } from '../lib/modCatalog'
import { reconcilePlugins } from './plugin-loader'
import { usePluginRegistry } from './plugin-manager'
import { PluginSlot } from './PluginSlot'
import { PageView } from '../components/editor/PageView'
import { useSettingsStore } from '../stores/settingsStore'
import { useTabStore } from '../stores/tabStore'

// The registry must use bundled code, even if installed copies cannot be read.
const io: ModFs = {
  exists: async () => true, mkdir: async () => {}, writeTextFile: async () => {},
  readTextFile: async () => { throw new Error('Local plugin code is not executable') },
  stat: async () => ({ size: 0 }), readDir: async () => [],
}
const mods: ModEntry[] = ['zoom', 'pixel-ruler', 'bookmarks'].map(name => ({ id: `Plugins/${name}`, folder: `/Mods/Plugins/${name}`,
  kind: 'Plugins', label: name, enabled: true, errors: [] }))
afterEach(async () => {
  await reconcilePlugins(io, [])
  useSettingsStore.setState({ zoom: 1, rulerGuides: [] })
})

it('runs compiled official plugins and unloads their visible controls and wheel handlers', async () => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  useTabStore.getState().reset('/book/page.md')
  expect(await reconcilePlugins(io, mods)).toEqual([])
  expect(usePluginRegistry.getState().plugins).toHaveLength(3)
  const host = document.createElement('div')
  const root = createRoot(host)
  try {
    await act(async () => root.render(<><PluginSlot slot="toolbar" /><PluginSlot slot="editorTools" /><PageView>Text</PageView></>))
    expect(host.querySelector('button[title="Bookmarks of this project"]')).not.toBeNull()
    const selector = host.querySelector<HTMLSelectElement>('[aria-label="Editor zoom"]')!
    expect(selector).not.toBeNull()
    await act(async () => { selector.value = '1.5'; selector.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(useSettingsStore.getState().zoom).toBe(1.5)
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Add row guide"]')!.click())
    expect(host.querySelector('[data-guide-axis="row"]')).not.toBeNull()
    const guide = useSettingsStore.getState().rulerGuides[0]
    await act(async () => { expect(await reconcilePlugins(io, mods.map(mod => ({ ...mod, enabled: false })))).toEqual([]) })
    expect(host.querySelector('[aria-label="Editor zoom"]')).toBeNull()
    expect(host.querySelector('button[title="Bookmarks of this project"]')).toBeNull()
    expect(host.querySelector('[data-ruler-overlay]')).toBeNull()
    expect(document.querySelector('[data-plugin-style]')).toBeNull()
    expect(useSettingsStore.getState().rulerGuides).toEqual([guide])
    await act(async () => host.querySelector('[data-editor-zoom]')!.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -1, bubbles: true, cancelable: true })))
    expect(useSettingsStore.getState().zoom).toBe(1.5)
    await act(async () => { expect(await reconcilePlugins(io, mods)).toEqual([]) })
    expect(host.querySelector('[data-guide-axis="row"]')).not.toBeNull()
    expect(host.querySelectorAll('[aria-label="Editor zoom"]')).toHaveLength(1)
  } finally { await act(async () => root.unmount()) }
})
