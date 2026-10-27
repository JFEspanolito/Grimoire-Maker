import { beforeEach, expect, it, vi } from 'vitest'
import { useModStore } from './modStore'
import { reconcilePlugins } from '../plugins/plugin-loader'
import { applyLocalPackages } from '../plugins/isolated/externalHost'
import { migrateLegacyFolders } from '../lib/migratedPlugins'
import { useTemplateStore } from './templateStore'

const state = vi.hoisted(() => ({
  deleteFiles: vi.fn(async (_mod: unknown) => {}),
  disabled: [] as string[], failWrite: false, gone: new Set<string>(),
  sync: { packages: [] as unknown[], errors: [] as { folder: string; message: string }[] } as { packages: unknown[]; errors: { folder: string; message: string }[] } | null,
  migrationErrors: [] as string[],
}))
vi.mock('../lib/localPackages', async (original) => ({
  ...await original<typeof import('../lib/localPackages')>(),
  syncLocalPackages: vi.fn(async () => state.sync),
}))
vi.mock('../lib/migratedPlugins', () => ({
  migrateLegacyFolders: vi.fn(async () => ({ converted: [], errors: state.migrationErrors })),
}))
vi.mock('../lib/modDelete', () => ({ deleteModFiles: state.deleteFiles }))
vi.mock('../plugins/plugin-loader', () => ({ reconcilePlugins: vi.fn(async () => []) }))
vi.mock('../plugins/isolated/externalHost', () => ({ applyLocalPackages: vi.fn(async () => {}) }))
vi.mock('../lib/modLibrary', () => ({
  modFs: {}, migrationFs: {}, OFFICIAL_PLUGINS: [], LEGACY_PLUGINS: [], restoreOfficialPlugin: vi.fn(async () => {}), prepareModLibrary: vi.fn(async () => ({ root: '/Mods', templates: '/Mods/Templates', plugins: '/Mods/Plugins', preferences: '/mods.json' })),
  readDisabledMods: vi.fn(async () => [...state.disabled]),
  writeDisabledMods: vi.fn(async (_path: string, disabled: string[]) => {
    if (state.failWrite) throw new Error('Disk full')
    state.disabled = disabled
  }),
}))
vi.mock('../lib/modCatalog', async (original) => ({
  ...await original<typeof import('../lib/modCatalog')>(),
  discoverMods: vi.fn(async (_fs: unknown, _root: string, disabled: string[]) => ({
    mods: [
      ...state.gone.has('Snippets/dnd') ? [] : [{ id: 'Snippets/dnd', kind: 'Snippets', label: 'DND', folder: '/Mods/Snippets/dnd', enabled: !disabled.includes('Snippets/dnd'), errors: [] }],
      { id: 'Templates/book', kind: 'Templates', label: 'Book', folder: '/Mods/Templates/book', enabled: !disabled.includes('Templates/book'), errors: [] },
      { id: 'Plugins/zoom', kind: 'Plugins', label: 'zoom', folder: '/Mods/Plugins/zoom', enabled: !disabled.includes('Plugins/zoom'), errors: [], package: true },
      { id: 'Plugins/mine', kind: 'Plugins', label: 'mine', folder: '/Mods/Plugins/mine', enabled: true, errors: [] },
    ],
    snippets: disabled.includes('Snippets/dnd') ? [] : [{ id: 'dnd/loot', label: 'Loot', group: 'DND', markdown: '# Loot' }], errors: [],
  })),
}))
vi.mock('../lib/templates', async (original) => ({
  ...await original<typeof import('../lib/templates')>(),
  loadUserTemplates: vi.fn(async (_taken: unknown, options: { dir?: string; allowedFolders?: Set<string> }) => ({
    dir: options.dir ?? '/legacy', themes: [], errors: [],
    templates: options.allowedFolders?.has('book') ? [{ id: 'book', label: 'Book', body: '# Start', frontmatter: {}, builtin: false }] : [],
  })),
}))

beforeEach(() => {
  state.deleteFiles.mockImplementation(async () => {})
  state.disabled = []
  state.gone = new Set()
  state.failWrite = false
  state.sync = { packages: [], errors: [] }
  state.migrationErrors = []
  vi.clearAllMocks()
  useModStore.setState({ root: null, ready: false, busy: false, mods: [], snippets: [], errors: [] })
})

it('persists disabled groups across rescans and filters template/snippet contributions', async () => {
  await useModStore.getState().reload()
  await useModStore.getState().setEnabled('Snippets/dnd', false)
  await useModStore.getState().setEnabled('Templates/book', false)
  await useModStore.getState().reload()
  expect(useModStore.getState().snippets).toEqual([])
  expect(useTemplateStore.getState().templates).toEqual([])
  expect(useModStore.getState().mods.filter((mod) => mod.kind !== 'Plugins').every((mod) => !mod.enabled)).toBe(true)
  await useModStore.getState().setEnabled('Templates/book', true)
  expect(useTemplateStore.getState().templates[0].id).toBe('book')
})
it('serializes refresh and rapid toggles without dropping the last choice', async () => {
  await useModStore.getState().reload()
  await Promise.all([
    useModStore.getState().setEnabled('Snippets/dnd', false),
    useModStore.getState().reload(),
    useModStore.getState().setEnabled('Snippets/dnd', true),
  ])
  expect(state.disabled).not.toContain('Snippets/dnd')
  expect(useModStore.getState().snippets).toHaveLength(1)
})
it('retains the active catalog when a preference write is rejected', async () => {
  await useModStore.getState().reload()
  state.failWrite = true
  await expect(useModStore.getState().setEnabled('Snippets/dnd', false)).rejects.toThrow('Disk full')
  expect(useModStore.getState().snippets).toHaveLength(1)
  expect(useModStore.getState().mods.find((mod) => mod.id === 'Snippets/dnd')?.enabled).toBe(true)
  expect(state.disabled).toEqual([])
})

it('never hands a package folder to the trusted loader', async () => {
  await useModStore.getState().reload()
  const ids = vi.mocked(reconcilePlugins).mock.calls[0][1].map((mod) => mod.id)
  expect(ids).toContain('Plugins/mine')
  expect(ids).not.toContain('Plugins/zoom')
})
it('migrates old copies before discovery and lists migration and sync problems with the folder', async () => {
  state.migrationErrors = ['Plugins/zoom: moving the old files to legacy/ failed: locked']
  state.sync = { packages: [{ folder: 'zoom', id: 'builtin.zoom', version: '2.0.0', fingerprint: 'f', changed: false }], errors: [{ folder: 'zoom', message: 'manifest.json is invalid' }] }
  await useModStore.getState().reload()
  expect(vi.mocked(migrateLegacyFolders).mock.calls[0][1]).toBe('/Mods/Plugins')
  const { errors, mods } = useModStore.getState()
  expect(errors).toEqual(expect.arrayContaining(['Plugins/zoom: moving the old files to legacy/ failed: locked', 'Plugins/zoom: manifest.json is invalid']))
  expect(mods.find((mod) => mod.id === 'Plugins/zoom')?.errors).toEqual(['manifest.json is invalid'])
})
it('activates package folders after the scan without waiting for them', async () => {
  await useModStore.getState().reload()
  await vi.waitFor(() => expect(applyLocalPackages).toHaveBeenCalledTimes(1))
  expect(vi.mocked(applyLocalPackages).mock.calls[0][0].some((mod) => mod.package)).toBe(true)
})
it('skips activation outside the desktop application', async () => {
  state.sync = null
  await useModStore.getState().reload()
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(applyLocalPackages).not.toHaveBeenCalled()
  expect(useModStore.getState().ready).toBe(true)
})

it('deletes a mod from disk, forgets its disabled flag and rescans', async () => {
  state.disabled = ['Snippets/dnd', 'Templates/book']
  await useModStore.getState().reload()
  await useModStore.getState().deleteMod('Snippets/dnd')
  expect(state.deleteFiles).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'Snippets/dnd', folder: '/Mods/Snippets/dnd' }))
  expect(state.disabled).toEqual(['Templates/book'])
  expect(reconcilePlugins).toHaveBeenCalledTimes(2)
})
it('keeps the disabled list and reports the error when the delete is refused, but still rescans', async () => {
  state.disabled = ['Snippets/dnd']
  await useModStore.getState().reload()
  state.deleteFiles.mockRejectedValueOnce(new Error('That mod is a link, so it was not deleted.'))
  await expect(useModStore.getState().deleteMod('Snippets/dnd')).rejects.toThrow('That mod is a link')
  expect(state.disabled).toEqual(['Snippets/dnd'])
  expect(useModStore.getState().errors).toEqual(['That mod is a link, so it was not deleted.'])
  expect(reconcilePlugins).toHaveBeenCalledTimes(2)
})
it('rescans after a delete that failed halfway, so a partly deleted mod leaves the list, and rethrows the original error', async () => {
  await useModStore.getState().reload()
  expect(useModStore.getState().mods.some((mod) => mod.id === 'Snippets/dnd')).toBe(true)
  // The delete removed part of the folder, then a locked file stopped it; the next scan no longer finds the mod.
  state.deleteFiles.mockImplementationOnce(async () => {
    state.gone.add('Snippets/dnd')
    throw new Error('The process cannot access the file')
  })
  await expect(useModStore.getState().deleteMod('Snippets/dnd')).rejects.toThrow('The process cannot access the file')
  expect(useModStore.getState().mods.some((mod) => mod.id === 'Snippets/dnd')).toBe(false)
  expect(useModStore.getState().busy).toBe(false)
  expect(useModStore.getState().errors).toEqual(['The process cannot access the file'])
})
it('never lets a failing rescan replace the delete error', async () => {
  await useModStore.getState().reload()
  state.deleteFiles.mockRejectedValueOnce(new Error('Locked'))
  state.sync = null
  vi.mocked(reconcilePlugins).mockRejectedValueOnce(new Error('Rescan exploded'))
  await expect(useModStore.getState().deleteMod('Snippets/dnd')).rejects.toThrow('Locked')
})
it('refuses to delete an id that is not in the catalog', async () => {
  await useModStore.getState().reload()
  await expect(useModStore.getState().deleteMod('Snippets/ghost')).rejects.toThrow('no longer in the catalog')
  expect(state.deleteFiles).not.toHaveBeenCalled()
})
it('still rescans when only the disabled-list cleanup fails', async () => {
  state.disabled = ['Snippets/dnd']
  await useModStore.getState().reload()
  state.failWrite = true
  await useModStore.getState().deleteMod('Snippets/dnd')
  expect(state.deleteFiles).toHaveBeenCalledOnce()
  expect(reconcilePlugins).toHaveBeenCalledTimes(2)
})
