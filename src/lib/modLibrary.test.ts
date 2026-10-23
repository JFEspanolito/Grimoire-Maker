import { beforeEach, expect, it, vi } from 'vitest'
import { exists, readTextFile, rename, stat, writeTextFile } from '@tauri-apps/plugin-fs'
import { MOD_EXAMPLES, readDisabledMods, writeDisabledMods } from './modLibrary'

vi.mock('@tauri-apps/plugin-fs', () => ({ exists: vi.fn(), mkdir: vi.fn(), readDir: vi.fn(), readTextFile: vi.fn(), rename: vi.fn(), stat: vi.fn(), writeTextFile: vi.fn() }))
beforeEach(() => { vi.resetAllMocks(); vi.mocked(stat).mockResolvedValue({ size: 100 } as Awaited<ReturnType<typeof stat>>) })

it('ships three Markdown templates and five D&D snippets, without executable examples', () => {
  expect(Object.keys(MOD_EXAMPLES).filter((path) => path.startsWith('Templates/'))).toHaveLength(3)
  expect(Object.keys(MOD_EXAMPLES).filter((path) => path.startsWith('Snippets/'))).toHaveLength(5)
  expect(Object.keys(MOD_EXAMPLES).every((path) => path.endsWith('.md'))).toBe(true)
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
