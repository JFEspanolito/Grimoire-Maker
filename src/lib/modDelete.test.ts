import { beforeEach, expect, it, vi } from 'vitest'
import { deleteModFiles } from './modDelete'
import type { ModEntry } from './modCatalog'

const mocks = vi.hoisted(() => ({ invoke: vi.fn(async () => {}), deleteUserTheme: vi.fn(async () => {}) }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('./themeEditor', () => ({ deleteUserTheme: mocks.deleteUserTheme }))

const mod = (kind: ModEntry['kind'], folder: string): ModEntry => ({ id: `${kind}/x`, kind, label: 'X', folder, enabled: true, errors: [] })
beforeEach(() => vi.clearAllMocks())

it.each(['Snippets', 'Templates', 'Plugins'] as const)('sends only the %s kind and the folder name to the native command', async (kind) => {
  await deleteModFiles(mod(kind, 'C:\\Users\\me\\Mods\\' + kind + '\\My Mod\\'))
  expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('delete_mod', { kind, name: 'My Mod' })
  expect(mocks.deleteUserTheme).not.toHaveBeenCalled()
})

it('removes a theme through the existing theme command using the file stem', async () => {
  await deleteModFiles(mod('Themes', '/config/themes/arcane.css'))
  expect(mocks.deleteUserTheme).toHaveBeenCalledExactlyOnceWith('arcane')
  expect(mocks.invoke).not.toHaveBeenCalled()
})

it('lets a native refusal reach the caller', async () => {
  mocks.invoke.mockRejectedValueOnce('That mod is a link, so it was not deleted.')
  await expect(deleteModFiles(mod('Plugins', '/Mods/Plugins/linked'))).rejects.toBe('That mod is a link, so it was not deleted.')
})
