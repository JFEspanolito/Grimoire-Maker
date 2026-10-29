/// <reference types="node" />
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LoadedLibraryPaths } from './preferences'
const scope = vi.hoisted(() => ({ root: '', rejectRename: false, picked: '', saved: '', reads: [] as string[], paths: null as LoadedLibraryPaths | null }))
vi.mock('./preferences', async (original) => {
  const actual = await original<typeof import('./preferences')>()
  return { ...actual, loadLibraryPaths: () => scope.paths ? Promise.resolve(scope.paths) : actual.loadLibraryPaths() }
})
vi.mock('./configRoot', () => ({ configRoot: async () => scope.root }))
vi.mock('@tauri-apps/api/path', () => ({ appConfigDir: async () => scope.root, join: async (...parts: string[]) => parts.join('/') }))
vi.mock('@tauri-apps/plugin-fs', async () => {
  const f = await import('node:fs/promises')
  return {
    readFile: (p: string) => f.readFile(p).then(b => new Uint8Array(b)),
    writeFile: (p: string, bytes: Uint8Array) => f.writeFile(p, bytes),
    remove: (p: string) => f.rm(p, { recursive: true }),
    exists: async (p: string) => f.access(p).then(() => true, () => false),
    mkdir: (p: string) => f.mkdir(p, { recursive: true }),
    readDir: async (p: string) => (await f.readdir(p, { withFileTypes: true })).map(e => ({ name: e.name, isDirectory: e.isDirectory(), isFile: e.isFile(), isSymlink: e.isSymbolicLink() })),
    readTextFile: (p: string) => { scope.reads.push(p); return f.readFile(p, 'utf8') },
    stat: (p: string) => f.stat(p),
    writeTextFile: (p: string, text: string, options?: { createNew?: boolean }) => f.writeFile(p, text, { flag: options?.createNew ? 'wx' : 'w' }),
    rename: (from: string, to: string) => { if (scope.rejectRename) throw new Error('probe rename failed'); return f.rename(from, to) },
  }
})
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: async () => scope.picked, save: async () => scope.saved }))
import { createTemplateZip, readTemplateZip } from './templatePackage'
import { importTemplateZip, exportTemplateZip, applyTemplateFiles } from './templateActions'
import { prepareModLibrary, MOD_EXAMPLES, LEGACY_PLUGINS } from './modLibrary'
import { useModStore } from '../stores/modStore'
import { useTemplateStore } from '../stores/templateStore'
import { loadUserTemplates } from './templates'
const put = async (relative: string, text: string) => { const p = `${scope.root}/${relative}`; await fs.mkdir(p.slice(0, p.lastIndexOf('/')), { recursive: true }); await fs.writeFile(p, text) }
beforeEach(async () => {
  scope.root = (await fs.mkdtemp(join(tmpdir(), 'grimoire-mod-integration-'))).replaceAll('\\', '/')
  scope.rejectRename = false
  scope.picked = ''
  scope.saved = ''
  scope.reads = []
  scope.paths = null
  await prepareModLibrary()
  await put('Mods/Snippets/Community/nested/01-note.md', '---\nsnippetName: Custom note\n---\n## Custom')
  await useModStore.getState().reload()
  await useModStore.getState().setEnabled('Snippets/community', true)
})
afterEach(async () => {
  const temporary = (await fs.realpath(tmpdir())).replaceAll('\\', '/')
  const root = (await fs.realpath(scope.root)).replaceAll('\\', '/')
  if (!root.startsWith(`${temporary}/grimoire-mod-integration-`)) throw new Error('Invalid integration cleanup boundary')
  await fs.rm(scope.root, { recursive: true, force: true })
})
it('seeds official copies but never executes folder code and keeps content declarative', async () => {
 await prepareModLibrary()
 expect(Object.keys(MOD_EXAMPLES).filter(p => /^Templates\/[^/]+\/index.md$/.test(p))).toHaveLength(8)
 await put('Mods/Snippets/Community/nested/01-note.md', '---\nsnippetName: Custom note\n---\n## Custom')
 await put('Mods/Snippets/Community/ignored.js', 'throw Error("must not run")')
 await put('Mods/Plugins/probe/index.js', 'throw Error("must not run")')
 await put('Mods/Templates/broken/README.md', 'missing index')
 await put('outside/index.md', '# Outside')
 await fs.symlink(`${scope.root}/outside`, `${scope.root}/Mods/Templates/linked`, 'junction')
 await useModStore.getState().reload()
 expect(useModStore.getState().snippets.find(s => s.label === 'Custom note')?.markdown).toBe('## Custom')
 expect(useModStore.getState().errors.join()).toContain('index.md')
 expect(useTemplateStore.getState().templates.some(t => t.id === 'linked')).toBe(false)
 expect(scope.reads.some(p => p.endsWith('/Snippets/Community/ignored.js'))).toBe(false)
 expect(scope.reads.some(p => p.endsWith('/Plugins/bookmarks/bookmarks.tsx'))).toBe(false)
 expect(scope.reads.some(p => p.endsWith('/Plugins/probe/index.js'))).toBe(false)
 expect(useModStore.getState().mods.some(mod => mod.id === 'Plugins/probe')).toBe(false)
 expect(useTemplateStore.getState().templates).toHaveLength(8)
})
it('configured paths survive reload, keep disabled IDs and legacy templates, and receive ZIP imports without reseeding', async () => {
  await useModStore.getState().setEnabled('Snippets/community', false)
  await put('templates/legacy/index.md', '# Legacy')
  const root = scope.root
  scope.paths = { plugins: `${root}/custom/plugins`, snippets: `${root}/custom/snippets`, templates: `${root}/custom/templates`, themes: `${root}/custom/themes`, logs: `${root}/logs` }
  await fs.cp(`${root}/Mods/Snippets`, scope.paths.snippets, { recursive: true })
  await fs.cp(`${root}/Mods/Templates`, scope.paths.templates, { recursive: true })
  await fs.mkdir(scope.paths.plugins, { recursive: true })
  await fs.mkdir(scope.paths.themes, { recursive: true })
  await fs.writeFile(`${scope.paths.plugins}/evil.js`, 'throw Error("never execute")')
  // Remove a copied shipped example: custom paths must not resurrect it.
  const example = Object.keys(MOD_EXAMPLES).find(path => path.startsWith('Templates/'))!
  await fs.unlink(`${scope.paths.templates}/${example.slice('Templates/'.length)}`)
  vi.resetModules()
  const restarted = (await import('../stores/modStore')).useModStore
  const templates = (await import('../stores/templateStore')).useTemplateStore
  await restarted.getState().reload()
  expect(restarted.getState().mods.find(mod => mod.id === 'Snippets/community')?.enabled).toBe(false)
  expect(restarted.getState().snippets.some(snippet => snippet.label === 'Custom note')).toBe(false)
  expect(templates.getState().templates.some(template => template.id === 'legacy')).toBe(true)
  expect(templates.getState().dir).toBe(scope.paths.templates)
  await expect(fs.access(`${scope.paths.templates}/${example.slice('Templates/'.length)}`)).rejects.toThrow()
  scope.picked = `${root}/configured.zip`
  await fs.writeFile(scope.picked, createTemplateZip({ 'index.md': new TextEncoder().encode('# Configured') }))
  await (await import('./templateActions')).importTemplateZip()
  expect(await fs.readFile(`${scope.paths.templates}/configured/index.md`, 'utf8')).toBe('# Configured')
  expect(scope.reads.some(path => path.endsWith('.js'))).toBe(false)
})

const exampleKeys = (folder: string) => Object.keys(MOD_EXAMPLES).filter(path => path.startsWith(`${folder}/`)).map(path => path.slice(folder.length + 1))
const present = (path: string) => fs.access(path).then(() => true, () => false)
it('seeds the shipped examples into native-managed folders (portable Data or installer content root) exactly once', async () => {
  const content = `${scope.root}/Data`
  const managedPaths = { plugins: `${content}/Plugins`, snippets: `${content}/Snippets`, templates: `${content}/Templates`, themes: `${content}/Themes`, logs: `${content}/Logs` }
  for (const folder of Object.values(managedPaths)) await fs.mkdir(folder, { recursive: true })
  scope.paths = { ...managedPaths, managed: { plugins: true, snippets: true, templates: true } }
  const library = await prepareModLibrary()
  expect(library).not.toHaveProperty('managed')
  expect(library.templates).toBe(managedPaths.templates)
  for (const relative of exampleKeys('Templates')) expect(await present(`${managedPaths.templates}/${relative}`)).toBe(true)
  for (const relative of exampleKeys('Snippets')) expect(await present(`${managedPaths.snippets}/${relative}`)).toBe(true)
  for (const relative of exampleKeys('Plugins')) expect(await present(`${managedPaths.plugins}/${relative}`)).toBe(true)
  for (const marker of [`${content}/.examples-seeded`, `${managedPaths.templates}/.editorial-templates-v2-seeded`, `${managedPaths.plugins}/.executable-plugins-v1-seeded`, `${managedPaths.snippets}/.rol-adventures-snippets-v2-seeded`]) expect(await present(marker)).toBe(true)
  expect(await present(`${managedPaths.themes}/.examples-seeded`)).toBe(false)
  // A removed or edited example is never restored or replaced on the next start.
  const removed = exampleKeys('Templates')[0]
  await fs.rm(`${managedPaths.templates}/${removed}`)
  await fs.writeFile(`${managedPaths.plugins}/zoom/index.md`, '# Mine')
  await prepareModLibrary()
  expect(await present(`${managedPaths.templates}/${removed}`)).toBe(false)
  expect(await fs.readFile(`${managedPaths.plugins}/zoom/index.md`, 'utf8')).toBe('# Mine')
})
it('seeds only the libraries the native side reports as managed and never a custom folder', async () => {
  const content = `${scope.root}/Installed`
  const custom = `${scope.root}/Custom`
  scope.paths = { plugins: `${content}/Plugins`, snippets: `${custom}/Snippets`, templates: `${custom}/Templates`, themes: `${content}/Themes`, logs: `${content}/Logs`, managed: { plugins: true } }
  for (const folder of [scope.paths.plugins, scope.paths.snippets, scope.paths.templates]) await fs.mkdir(folder, { recursive: true })
  await prepareModLibrary()
  expect(await present(`${scope.paths.plugins}/zoom/manifest.json`)).toBe(true)
  expect(await fs.readdir(scope.paths.snippets)).toEqual([])
  expect(await fs.readdir(scope.paths.templates)).toEqual([])
  // A flagged library whose folder does not carry the library name is not guessed at.
  scope.paths = { ...scope.paths, snippets: `${content}/MySnippets`, managed: { snippets: true } }
  await fs.mkdir(scope.paths.snippets, { recursive: true })
  await prepareModLibrary()
  expect(await fs.readdir(scope.paths.snippets)).toEqual([])
})
it('without a managed flag the original Mods library keeps seeding exactly as before', async () => {
  for (const relative of exampleKeys('Templates')) expect(await present(`${scope.root}/Mods/Templates/${relative}`)).toBe(true)
  for (const relative of exampleKeys('Plugins')) expect(await present(`${scope.root}/Mods/Plugins/${relative}`)).toBe(true)
  expect(await present(`${scope.root}/Mods/.examples-seeded`)).toBe(true)
  expect(await present(`${scope.root}/Mods/Templates/.editorial-templates-v2-seeded`)).toBe(true)
  expect(await present(`${scope.root}/Mods/Plugins/.executable-plugins-v1-seeded`)).toBe(true)
})

it('upgrades old descriptor installations without overwriting edited executable files', async () => {
  const plugins = `${scope.root}/Mods/Plugins`
  await fs.unlink(`${plugins}/.executable-plugins-v1-seeded`)
  await fs.writeFile(`${plugins}/.plugins-seeded`, '1\n')
  await fs.writeFile(`${plugins}/bookmarks/bookmarks.tsx`, '// author edit')
  await fs.unlink(`${plugins}/bookmarks/anchors.ts`)
  await prepareModLibrary()
  expect(await fs.readFile(`${plugins}/bookmarks/bookmarks.tsx`, 'utf8')).toBe('// author edit')
  expect(await fs.readFile(`${plugins}/bookmarks/anchors.ts`, 'utf8')).toBe(MOD_EXAMPLES['Plugins/bookmarks/anchors.ts'])
  expect(await fs.readFile(`${plugins}/.executable-plugins-v1-seeded`, 'utf8')).toBe('1\n')
})
it('toggle serializes with refresh and survives a module-level app restart without builtins fallback', async () => {
 await Promise.all([useModStore.getState().setEnabled('Snippets/community', false), useModStore.getState().reload(), useModStore.getState().setEnabled('Snippets/community', true)])
 expect(useModStore.getState().snippets.some(s => s.label === 'Custom note')).toBe(true)
 await useModStore.getState().setEnabled('Snippets/community', false)
 for (const mod of useModStore.getState().mods.filter(m => m.kind === 'Templates')) await useModStore.getState().setEnabled(mod.id, false)
 vi.resetModules()
 const restarted = (await import('../stores/modStore')).useModStore
 const restartedTemplates = (await import('../stores/templateStore')).useTemplateStore
 await restarted.getState().reload()
 expect(restarted.getState().snippets.some(s => s.label === 'Custom note')).toBe(false)
 expect(restartedTemplates.getState().templates).toEqual([])
})
it('publication failure keeps exact preference bytes and active catalog, then recovers', async () => {
 await useModStore.getState().setEnabled('Snippets/community', false)
 const before = await fs.readFile(`${scope.root}/mods.json`, 'utf8')
 const snippets = useModStore.getState().snippets
 scope.rejectRename = true
 await expect(useModStore.getState().setEnabled('Snippets/community', true)).rejects.toThrow('probe rename failed')
 expect(await fs.readFile(`${scope.root}/mods.json`, 'utf8')).toBe(before)
 expect(useModStore.getState().snippets).toEqual(snippets)
 scope.rejectRename = false
 await useModStore.getState().setEnabled('Snippets/community', true)
 expect(useModStore.getState().snippets.some(s => s.label === 'Custom note')).toBe(true)
})
it('standalone folder remains projectless but chapter/assets packages require a project', async () => {
 await put('templates/oldpack/index.md', '# Standalone')
 await put('templates/chapters/index.md', '# Chapters')
 await put('templates/chapters/chapters/01.md', '# First')
 await put('templates/assets/index.md', '# Assets')
 await put('templates/assets/assets/map.txt', 'map')
 const current = await loadUserTemplates(new Set())
 expect(current.templates.find(t => t.id === 'oldpack')?.requiresProject).toBe(false)
 expect(current.templates.find(t => t.id === 'chapters')?.requiresProject).toBe(true)
 expect(current.templates.find(t => t.id === 'assets')?.requiresProject).toBe(true)
})
it('ZIP import routes into Mods, export round-trips, application preserves prior Draft content', async () => {
 const encode = (s: string) => new TextEncoder().encode(s)
 const files = { 'index.md': encode('---\ntitle: Imported\n---\n# Imported'), 'chapters/01.md': encode('# First'), 'assets/map.png': new Uint8Array([1,2,3]), 'snippets/loot.md': encode('## Loot') }
 scope.picked = `${scope.root}/downloaded.zip`
 scope.saved = `${scope.root}/exported.zip`
 await fs.writeFile(scope.picked, createTemplateZip(files))
 const id = await importTemplateZip()
 expect(id).toBe('downloaded')
 const { templates } = await loadUserTemplates(new Set(), { dir: `${scope.root}/Mods/Templates`, reservedIds: [] })
 const imported = templates.find(t => t.id === id)!
 expect(imported.requiresProject).toBe(true)
 expect(imported.snippets).toHaveLength(1)
 expect(await exportTemplateZip(imported)).toBe(true)
 const normalize = (f: Record<string, Uint8Array>) => Object.fromEntries(Object.entries(f).map(([k,v]) => [k, Array.from(v)]))
 expect(normalize(readTemplateZip(new Uint8Array(await fs.readFile(scope.saved))))).toEqual(normalize(files))
 await put('project/Draft/downloaded/index.md', '# Existing')
 const index = await applyTemplateFiles(imported, `${scope.root}/project`)
 expect(index).toBe(`${scope.root}/project/Draft/downloaded-1/index.md`)
 expect(await fs.readFile(`${scope.root}/project/Draft/downloaded/index.md`, 'utf8')).toBe('# Existing')
 expect(await fs.readFile(index, 'utf8')).toContain('# Imported')
 expect(await fs.readFile(`${scope.root}/project/Draft/downloaded-1/chapters/01.md`, 'utf8')).toBe('# First')
 expect(new Uint8Array(await fs.readFile(`${scope.root}/project/Draft/downloaded-1/assets/map.png`))).toEqual(files['assets/map.png'])
})

it('upgrades legacy template examples without replacing edits and applies every chapter', async () => {
  const marker = `${scope.root}/Mods/Templates/.editorial-templates-v2-seeded`
  await fs.rm(marker, { force: true })
  await put('Mods/Templates/rpg-adventure-module/index.md', '---\ntemplateName: My edited adventure\n---\n# Keep my edits')
  await fs.rm(`${scope.root}/Mods/Templates/rpg-adventure-module/chapters`, { recursive: true, force: true })
  await prepareModLibrary()
  expect(await fs.readFile(`${scope.root}/Mods/Templates/rpg-adventure-module/index.md`, 'utf8')).toContain('Keep my edits')
  const { templates } = await loadUserTemplates(new Set(), { dir: `${scope.root}/Mods/Templates`, reservedIds: [] })
  for (const template of templates) {
    expect(template.requiresProject).toBe(true)
    const index = await applyTemplateFiles(template, `${scope.root}/project`)
    for (const [path, text] of Object.entries(MOD_EXAMPLES)) {
      const prefix = `Templates/${template.id}/chapters/`
      if (!path.startsWith(prefix)) continue
      const relative = path.slice(`Templates/${template.id}/`.length)
      expect(await fs.readFile(`${index.slice(0, -'index.md'.length)}${relative}`, 'utf8')).toBe(text)
    }
    expect(await fs.access(`${index.slice(0, -'index.md'.length)}README.md`).then(() => true, () => false)).toBe(false)
  }
})

const legacyFiles = (folder: string) => LEGACY_PLUGINS.find(plugin => plugin.folder === folder)!.files
/** Recreates the folder an older release seeded, as trusted TSX sources. */
const copyLegacy = async (folder: string) => {
  for (const [relative, text] of Object.entries(legacyFiles(folder))) await put(`Mods/Plugins/${folder}/${relative}`, text)
}
const exists = (path: string) => fs.access(path).then(() => true, () => false)

it('seeds Zoom and Pixel Ruler as example packages and never the old trusted sources', async () => {
  const plugins = `${scope.root}/Mods/Plugins`
  expect(await fs.readFile(`${plugins}/zoom/manifest.json`, 'utf8')).toBe(MOD_EXAMPLES['Plugins/zoom/manifest.json'])
  expect(await exists(`${plugins}/pixel-ruler/dist/index.js`)).toBe(true)
  expect(await fs.readFile(`${plugins}/pixel-ruler/index.md`, 'utf8')).toContain('pnpm pack:plugin')
  expect(await exists(`${plugins}/zoom/zoom.tsx`)).toBe(false)
  expect(await exists(`${scope.root}/Mods/Legacy`)).toBe(false)
  expect(Object.keys(MOD_EXAMPLES).some(path => path.startsWith('Legacy/'))).toBe(false)
  const mods = useModStore.getState().mods
  expect(mods.find(mod => mod.id === 'Plugins/zoom')?.package).toBe(true)
  expect(mods.find(mod => mod.id === 'Plugins/bookmarks')?.package).toBeUndefined()
  expect(useModStore.getState().missingOfficial.map(plugin => plugin.folder)).toEqual([])
  expect(useModStore.getState().errors.join()).not.toContain('Plugins/zoom')
})

it('restores a deleted example package without overwriting the user edits in the other one', async () => {
  const plugins = `${scope.root}/Mods/Plugins`
  await fs.rm(`${plugins}/zoom`, { recursive: true })
  await put('Mods/Plugins/pixel-ruler/manifest.json', '{ "edited": true }')
  await useModStore.getState().reload()
  expect(useModStore.getState().missingOfficial.map(plugin => plugin.folder)).toEqual(['zoom'])
  await useModStore.getState().installOfficial('zoom')
  expect(await fs.readFile(`${plugins}/zoom/dist/index.js`, 'utf8')).toBe(MOD_EXAMPLES['Plugins/zoom/dist/index.js'])
  expect(await fs.readFile(`${plugins}/pixel-ruler/manifest.json`, 'utf8')).toBe('{ "edited": true }')
})

it('keeps an old official source copy untouched while running the compiled implementation', async () => {
  const folder = `${scope.root}/Mods/Plugins/zoom`
  await fs.rm(folder, { recursive: true })
  await copyLegacy('zoom')
  await put('Mods/Plugins/zoom/index.md', '# Old documentation')
  await useModStore.getState().reload()
  expect(await exists(`${folder}/manifest.json`)).toBe(false)
  expect(await fs.readFile(`${folder}/index.md`, 'utf8')).toBe('# Old documentation')
  for (const file of ['zoom.tsx', 'script.ts', 'Zoom.module.css']) {
    expect(await fs.readFile(`${folder}/${file}`, 'utf8')).toBe(legacyFiles('zoom')[file])
    expect(await exists(`${folder}/legacy/${file}`)).toBe(false)
  }
  const mod = useModStore.getState().mods.find(item => item.id === 'Plugins/zoom')!
  expect(mod.package).toBeUndefined()
  expect(useModStore.getState().errors).toEqual([])
  const snapshot = (await fs.readdir(folder, { recursive: true })).sort()
  await useModStore.getState().reload()
  expect((await fs.readdir(folder, { recursive: true })).sort()).toEqual(snapshot)
})

it('preserves edited official copies without executing their code', async () => {
  const folder = `${scope.root}/Mods/Plugins/zoom`
  await fs.rm(folder, { recursive: true })
  await copyLegacy('zoom')
  await put('Mods/Plugins/zoom/zoom.tsx', `${legacyFiles('zoom')['zoom.tsx']}
throw new Error('Edited source must not execute')`)
  await useModStore.getState().reload()
  expect(await exists(`${folder}/manifest.json`)).toBe(false)
  expect(await exists(`${folder}/legacy`)).toBe(false)
  expect(await fs.readFile(`${folder}/zoom.tsx`, 'utf8')).toContain('Edited source must not execute')
  expect(useModStore.getState().errors).toEqual([])
  expect(useModStore.getState().mods.find(mod => mod.id === 'Plugins/zoom')?.package).toBeUndefined()
})

it('uses compiled Bookmarks without replacing old or edited source files', async () => {
  const folder = `${scope.root}/Mods/Plugins/bookmarks`
  await fs.rm(folder, { recursive: true })
  await copyLegacy('bookmarks')
  await useModStore.getState().reload()
  expect(await fs.readFile(`${folder}/bookmarks.tsx`, 'utf8')).toBe(legacyFiles('bookmarks')['bookmarks.tsx'])
  expect(await exists(`${folder}/legacy/bookmarks.tsx`)).toBe(false)
  expect(await exists(`${folder}/manifest.json`)).toBe(false)
  expect(useModStore.getState().errors).toEqual([])
  const snapshot = (await fs.readdir(folder, { recursive: true })).sort()
  await useModStore.getState().reload()
  expect((await fs.readdir(folder, { recursive: true })).sort()).toEqual(snapshot)

  await fs.rm(folder, { recursive: true })
  await copyLegacy('bookmarks')
  await put('Mods/Plugins/bookmarks/bookmarks.tsx', `${legacyFiles('bookmarks')['bookmarks.tsx']}
// my tweak`)
  await useModStore.getState().reload()
  expect(await exists(`${folder}/legacy`)).toBe(false)
  expect(await fs.readFile(`${folder}/bookmarks.tsx`, 'utf8')).toContain('// my tweak')
})
