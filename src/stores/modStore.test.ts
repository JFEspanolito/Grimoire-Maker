import { beforeEach, expect, it, vi } from 'vitest'
import { useModStore } from './modStore'
import { useTemplateStore } from './templateStore'

const state = vi.hoisted(() => ({ disabled: [] as string[], failWrite: false }))
vi.mock('../lib/modLibrary', () => ({
  modFs: {}, prepareModLibrary: vi.fn(async () => ({ root: '/Mods', templates: '/Mods/Templates', preferences: '/mods.json' })),
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
      { id: 'Snippets/dnd', kind: 'Snippets', label: 'DND', folder: '/Mods/Snippets/dnd', enabled: !disabled.includes('Snippets/dnd'), errors: [] },
      { id: 'Templates/book', kind: 'Templates', label: 'Book', folder: '/Mods/Templates/book', enabled: !disabled.includes('Templates/book'), errors: [] },
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
  state.disabled = []
  state.failWrite = false
  useModStore.setState({ root: null, ready: false, busy: false, mods: [], snippets: [], errors: [] })
})

it('persists disabled groups across rescans and filters template/snippet contributions', async () => {
  await useModStore.getState().reload()
  await useModStore.getState().setEnabled('Snippets/dnd', false)
  await useModStore.getState().setEnabled('Templates/book', false)
  await useModStore.getState().reload()
  expect(useModStore.getState().snippets).toEqual([])
  expect(useTemplateStore.getState().templates).toEqual([])
  expect(useModStore.getState().mods.every((mod) => !mod.enabled)).toBe(true)
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
  expect(useModStore.getState().mods[0].enabled).toBe(true)
  expect(state.disabled).toEqual([])
})
