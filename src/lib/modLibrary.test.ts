import { beforeEach, expect, it, vi } from 'vitest'
import { exists, readTextFile, rename, stat, writeTextFile } from '@tauri-apps/plugin-fs'
import { LEGACY_PLUGINS, MOD_EXAMPLES, OFFICIAL_PLUGINS, readDisabledMods, writeDisabledMods } from './modLibrary'

vi.mock('@tauri-apps/plugin-fs', () => ({ exists: vi.fn(), mkdir: vi.fn(), readDir: vi.fn(), readTextFile: vi.fn(), rename: vi.fn(), stat: vi.fn(), writeTextFile: vi.fn() }))
beforeEach(() => { vi.resetAllMocks(); vi.mocked(stat).mockResolvedValue({ size: 100 } as Awaited<ReturnType<typeof stat>>) })

it('ships declarative content plus complete executable Zoom and Ruler packages', () => {
  for (const id of ['classic-fantasy', 'quick-one-shot', 'a5-zine']) {
    expect(MOD_EXAMPLES[`Templates/${id}/README.md`]).toContain('Create your own')
    expect(Object.keys(MOD_EXAMPLES).filter(path => path.startsWith(`Templates/${id}/chapters/`)).length).toBeGreaterThanOrEqual(3)
  }
  expect(Object.keys(MOD_EXAMPLES).filter((path) => path.startsWith('Snippets/'))).toHaveLength(22)
  expect(Object.keys(MOD_EXAMPLES).filter(path => !path.startsWith('Plugins/')).every(path => path.endsWith('.md'))).toBe(true)
  for (const folder of ['zoom', 'pixel-ruler']) {
    expect(Object.keys(MOD_EXAMPLES).filter(path => path.startsWith(`Plugins/${folder}/`)).sort())
      .toEqual([`Plugins/${folder}/dist/index.js`, `Plugins/${folder}/index.md`, `Plugins/${folder}/manifest.json`])
    expect(JSON.parse(MOD_EXAMPLES[`Plugins/${folder}/manifest.json`]).id).toBe(`builtin.${folder}`)
    expect(MOD_EXAMPLES[`Plugins/${folder}/index.md`]).toContain('pnpm pack:plugin')
  }
  expect(OFFICIAL_PLUGINS.map(plugin => plugin.folder)).toEqual(['bookmarks', 'pixel-ruler', 'zoom'])
  expect(OFFICIAL_PLUGINS.find(plugin => plugin.folder === 'zoom')).toMatchObject({ label: 'Zoom' })
})
it('keeps the old trusted sources apart as the legacy baseline, never as seedable examples', () => {
  expect(Object.keys(MOD_EXAMPLES).some(path => path.startsWith('Legacy/'))).toBe(false)
  expect(LEGACY_PLUGINS.map(plugin => plugin.folder)).toEqual(['bookmarks', 'pixel-ruler', 'zoom'])
  expect(LEGACY_PLUGINS.find(plugin => plugin.folder === 'zoom')?.files['zoom.tsx']).toContain('registerToolbar')
  expect(LEGACY_PLUGINS.find(plugin => plugin.folder === 'pixel-ruler')?.files['RulerOverlay.tsx']).toContain('GuideLine')
})
it('does not silently overwrite malformed preferences', async () => {
  vi.mocked(exists).mockResolvedValue(true)
  vi.mocked(readTextFile).mockResolvedValue('{ broken')
  await expect(readDisabledMods('/mods.json')).rejects.toThrow()
  expect(writeTextFile).not.toHaveBeenCalled()
})
it('publishes preferences only after a complete temporary write', async () => {
  vi.mocked(writeTextFile).mockResolvedValue(undefined)
  vi.mocked(rename).mockResolvedValue(undefined)
  await writeDisabledMods('/mods.json', ['Snippets/dnd', 'Snippets/dnd'])
  const [temporary, contents, options] = vi.mocked(writeTextFile).mock.calls[0]
  expect(String(temporary)).toMatch(/^\/mods\.json\..+\.tmp$/)
  expect(JSON.parse(String(contents))).toEqual({ version: 1, disabled: ['Snippets/dnd'] })
  expect(options).toEqual({ createNew: true })
  expect(rename).toHaveBeenCalledWith(temporary, '/mods.json')
})
it('does not replace preferences after a failed temporary write', async () => {
  vi.mocked(writeTextFile).mockRejectedValue(new Error('Disk full'))
  await expect(writeDisabledMods('/mods.json', [])).rejects.toThrow('Disk full')
  expect(rename).not.toHaveBeenCalled()
})
