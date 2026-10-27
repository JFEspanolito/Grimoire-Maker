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
it('requires a project for an exported project layout and for Chapters/Assets folders in any letter case', async () => {
  vi.mocked(readTextFile).mockImplementation(async (path) => String(path).endsWith('/exported/index.md')
    ? '---\ntemplateName: Exported\ntemplateLayout: project\n---\n# Begin'
    : '---\ntemplateName: Adventure\n---\n# Begin')
  vi.mocked(readDir).mockImplementation(async (path) => {
    const p = String(path)
    if (p === '/Mods/Templates') return [file('exported', true), file('upper', true), file('plain', true)]
    if (p.endsWith('/exported')) return [file('index.md'), file('Draft', true), file('Research', true)]
    if (p.endsWith('/upper')) return [file('index.md'), file('Assets', true)]
    return [file('index.md')]
  })
  const result = await loadUserTemplates(new Set(), { dir: '/Mods/Templates', reservedIds: [] })
  const byId = Object.fromEntries(result.templates.map((template) => [template.id, template]))
  expect(byId.exported.layout).toBe('project')
  expect(byId.exported.requiresProject).toBe(true)
  expect(byId.upper.requiresProject).toBe(true)
  expect(byId.plain.requiresProject).toBe(false)
})
