import { beforeEach, expect, it, vi } from 'vitest'
import { readDir, readTextFile, stat } from '@tauri-apps/plugin-fs'
import { loadUserTemplates } from './templates'

vi.mock('@tauri-apps/plugin-fs', () => ({ exists: vi.fn(), mkdir: vi.fn(), readDir: vi.fn(), readTextFile: vi.fn(), stat: vi.fn() }))
vi.mock('./themes', async (original) => ({ ...await original<typeof import('./themes')>(), ensureConfigSubdir: vi.fn(async () => '/legacy') }))
const file = (name: string, isDirectory = false, isSymlink = false) => ({ name, isDirectory, isSymlink, isFile: !isDirectory })
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(stat).mockResolvedValue({ size: 100 } as Awaited<ReturnType<typeof stat>>)
  vi.mocked(readTextFile).mockResolvedValue('---\ntemplateName: Adventure\n---\n# Begin')
})
it('keeps legacy loose Markdown and package behavior', async () => {
  vi.mocked(readDir).mockImplementation(async (path) => String(path) === '/legacy' ? [file('loose.md'), file('pack', true)] : [file('index.md')])
  const result = await loadUserTemplates(new Set())
  expect(result.templates.map((template) => template.id)).toEqual(['loose', 'pack'])
  expect(result.templates[0].location).toEqual({ kind: 'file', path: '/legacy/loose.md' })
  expect(result.templates[1].location).toEqual({ kind: 'package', path: '/legacy/pack' })
  expect(result.templates[1].requiresProject).toBe(false)
})
it('loads only enabled Mods folders and never follows a linked index', async () => {
  vi.mocked(readDir).mockImplementation(async (path) => String(path) === '/Mods/Templates'
    ? [file('enabled', true), file('disabled', true), file('linked', true)]
    : [file('index.md', false, String(path).endsWith('linked'))])
  const result = await loadUserTemplates(new Set(), { dir: '/Mods/Templates', reservedIds: [], allowedFolders: new Set(['enabled', 'linked']) })
  expect(result.templates.map((template) => template.id)).toEqual(['enabled'])
  expect(result.errors.join()).toContain('regular index.md')
  expect(readTextFile).not.toHaveBeenCalledWith('/Mods/Templates/disabled/index.md')
  expect(readTextFile).not.toHaveBeenCalledWith('/Mods/Templates/linked/index.md')
})
