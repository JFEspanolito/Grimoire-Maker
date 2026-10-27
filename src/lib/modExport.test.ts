import { beforeEach, describe, expect, it, vi } from 'vitest'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { importModFromPath } from './modImport'
import {
  VOLATILE_FRONTMATTER_KEYS,
  buildSnippetPack,
  buildTemplateExport,
  buildThemeExport,
  exportProjectAsTemplate,
  exportSnippet,
  exportSnippetPack,
  exportSnippetPackFrom,
  exportTheme,
  readProjectTree,
} from './modExport'
import type { PackageFs, ProjectPackageFs } from './templateIo'
import { LIMITS, readTemplatePackage } from './templatePackage'
import { useDocumentStore } from '../stores/documentStore'

const mocks = vi.hoisted(() => ({
  fs: { stat: vi.fn(), exists: vi.fn(), mkdir: vi.fn(), readDir: vi.fn(), readFile: vi.fn(), writeFile: vi.fn(), readTextFile: vi.fn(), writeTextFile: vi.fn() },
  dialog: { save: vi.fn(), open: vi.fn() },
}))
vi.mock('@tauri-apps/plugin-fs', () => mocks.fs)
vi.mock('@tauri-apps/plugin-dialog', () => mocks.dialog)
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => false }))
vi.mock('./preferences', () => ({
  loadLibraryPaths: async () => ({ snippets: '/Mods/Snippets', templates: '/Mods/Templates', themes: '/Themes', plugins: '/Mods/Plugins', logs: '/logs' }),
}))
vi.mock('./modLibrary', () => ({
  prepareModLibrary: vi.fn(async () => ({
    root: '/Mods', snippets: '/Mods/Snippets', templates: '/Mods/Templates', themes: '/Mods/Themes', plugins: '/Mods/Plugins', logs: '/logs', preferences: '/mods.json',
  })),
}))

/** In-memory PackageFs rooted at the mod library, enough for the importer. */
function memoryFs(initial: Record<string, Uint8Array> = {}) {
  const files = new Map<string, Uint8Array>(Object.entries(initial))
  const folders = new Set<string>(['/Mods', '/Mods/Snippets', '/Mods/Templates', '/Mods/Themes', '/Mods/Plugins'])
  const addParents = (path: string) => {
    for (let at = path.lastIndexOf('/'); at > 0; at = path.lastIndexOf('/', at - 1)) folders.add(path.slice(0, at))
  }
  for (const path of files.keys()) addParents(path)
  const fs: PackageFs = {
    readFile: async (path) => {
      const data = files.get(path)
      if (!data) throw new Error(`Missing file: ${path}`)
      return data
    },
    writeFile: async (path, data) => { files.set(path, data); addParents(path) },
    mkdir: async (path) => { folders.add(path) },
    exists: async (path) => files.has(path) || folders.has(path),
    readDir: async (path) => {
      const out = new Map<string, { name: string; isDirectory: boolean }>()
      for (const dir of folders) if (dir.slice(0, dir.lastIndexOf('/')) === path) out.set(dir.slice(path.length + 1), { name: dir.slice(path.length + 1), isDirectory: true })
      for (const file of files.keys()) if (file.slice(0, file.lastIndexOf('/')) === path && !out.has(file.slice(path.length + 1))) out.set(file.slice(path.length + 1), { name: file.slice(path.length + 1), isDirectory: false })
      return [...out.values()]
    },
  }
  return { fs, files }
}

const text = (files: Map<string, Uint8Array>, path: string): string => strFromU8(files.get(path)!)
const b64 = (bytes: Uint8Array): string => {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}
/** A byte string with a real file signature followed by deterministic filler, at least `size` bytes long. */
function asset(signature: number[], size: number, seed: number): Uint8Array {
  const bytes = new Uint8Array(size)
  bytes.set(signature)
  for (let i = signature.length; i < size; i++) bytes[i] = (i * 31 + seed) & 255
  return bytes
}
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const WOFF2 = [0x77, 0x4f, 0x46, 0x32]

beforeEach(() => {
  vi.clearAllMocks()
})

describe('buildThemeExport', () => {
  const plain = "[data-theme=\"mine\"] { --page-bg: #fff; }\n[data-theme='mine'] h1 { color: red; }"

  it('makes a plain .css that starts with a single @name and uses the single-quoted selector', () => {
    const built = buildThemeExport(`/* @name: Old name */\n${plain}`, 'mine', 'My Theme')
    expect(built.kind).toBe('css')
    expect(built.fileName).toBe('mine.css')
    const css = strFromU8(built.bytes)
    expect(css.startsWith('/* @name: My Theme */\n')).toBe(true)
    expect(css.match(/@name:/g)).toHaveLength(1)
    expect(css).not.toContain('data-theme="mine"')
    expect(css.match(/data-theme='mine'/g)).toHaveLength(2)
  })

  it('refuses a theme that loads remote resources or lacks its selector', () => {
    expect(() => buildThemeExport("@import url(https://x.test/a.css);\n[data-theme='mine'] {}", 'mine', 'x')).toThrow(/remote/)
    expect(() => buildThemeExport('body {}', 'mine', 'x')).toThrow(/selector/)
    expect(() => buildThemeExport(plain, '../mine', 'x')).toThrow(/Invalid theme ID/)
  })

  it('keeps the @name comment safe from a name that tries to close it', () => {
    const css = strFromU8(buildThemeExport(plain, 'mine', 'Evil */ body { display:none } /*').bytes)
    expect(css.split('\n')[0]).toBe('/* @name: Evil  body { display:none } /* */')
  })

  describe('with embedded assets', () => {
    const font = asset(WOFF2, 3000, 1)
    const image = asset(PNG, 4096, 2)
    const tiny = asset(PNG, 300, 3)
    const css = [
      `@font-face { font-family: Fancy; src: url(data:font/woff2;base64,${b64(font)}) format('woff2'); }`,
      `[data-theme="mine"] { background: url('data:image/png;base64,${b64(image)}'); }`,
      `[data-theme='mine'] .again { background: url("data:image/png;base64,${b64(image)}"); }`,
      `[data-theme='mine'] .small { background: url(data:image/png;base64,${b64(tiny)}); }`,
    ].join('\n')

    it('packs fonts and images of 2 KiB or more as theme-pack/assets, sharing identical bytes', () => {
      const built = buildThemeExport(css, 'mine', 'Mine')
      expect(built.kind).toBe('zip')
      expect(built.fileName).toBe('mine.zip')
      const entries = unzipSync(built.bytes)
      expect(Object.keys(entries).sort()).toEqual(['theme-pack/assets/font-1.woff2', 'theme-pack/assets/image-1.png', 'theme-pack/theme.css'])
      expect(Array.from(entries['theme-pack/assets/font-1.woff2'])).toEqual(Array.from(font))
      const themeCss = strFromU8(entries['theme-pack/theme.css'])
      expect(themeCss.startsWith('/* @name: Mine */\n')).toBe(true)
      expect(themeCss.split('assets/image-1.png')).toHaveLength(3)
      expect(themeCss).toContain('url("assets/font-1.woff2")')
      expect(themeCss).toContain(`data:image/png;base64,${b64(tiny)}`)
      expect(themeCss).not.toContain(b64(image))
    })

    it('is deterministic', () => {
      expect(Array.from(buildThemeExport(css, 'mine', 'Mine').bytes)).toEqual(Array.from(buildThemeExport(css, 'mine', 'Mine').bytes))
    })

    it('round-trips through Mod Manager import: the installed theme is one self-contained CSS again', async () => {
      const built = buildThemeExport(css, 'mine', 'Mine')
      const { fs, files } = memoryFs({ '/dl/mine.zip': built.bytes })
      const id = await importModFromPath('/dl/mine.zip', 'zip', 'Themes', fs)
      expect(id).toBe('mine')
      const installed = text(files, '/Mods/Themes/mine.css')
      expect(installed).toContain('/* @name: Mine */')
      expect(installed).toContain(`data:font/woff2;base64,${b64(font)}`)
      expect(installed.split(`data:image/png;base64,${b64(image)}`)).toHaveLength(3)
      expect(installed).toContain(`data:image/png;base64,${b64(tiny)}`)
      expect(installed).not.toContain('assets/')
      expect(installed).toContain('data-theme="mine"')
    })

    it('gives the installed theme a new unique id when the id is taken, rewriting every selector', async () => {
      const built = buildThemeExport(css, 'mine', 'Mine')
      const { fs, files } = memoryFs({ '/dl/mine.zip': built.bytes, '/Mods/Themes/mine.css': strToU8('x') })
      expect(await importModFromPath('/dl/mine.zip', 'zip', 'Themes', fs)).toBe('mine-1')
      const installed = text(files, '/Mods/Themes/mine-1.css')
      expect(installed).not.toContain("data-theme='mine'")
      expect(installed.match(/data-theme="mine-1"/g)).toHaveLength(3)
    })

    it('accepts a pack inside a single wrapper folder', async () => {
      const entries = unzipSync(buildThemeExport(css, 'mine', 'Mine').bytes)
      const wrapped = zipSync(Object.fromEntries(Object.entries(entries).map(([name, data]) => [name.replace('theme-pack/', 'my-wrapper/'), data])))
      const { fs, files } = memoryFs({ '/dl/wrapped.zip': wrapped })
      expect(await importModFromPath('/dl/wrapped.zip', 'zip', 'Themes', fs)).toBe('wrapped')
      expect(text(files, '/Mods/Themes/wrapped.css')).toContain(`data:font/woff2;base64,${b64(font)}`)
    })

    const pack = (themeCss: string, extra: Record<string, Uint8Array> = {}) =>
      zipSync({ 'theme.css': strToU8(themeCss), 'assets/a.png': asset(PNG, 2500, 4), ...extra })

    it.each([
      ['a reference to a file the pack does not have', "[data-theme='x'] { background: url(assets/missing.png); }", /not in the pack/],
      ['a remote resource', "[data-theme='x'] { background: url(https://evil.test/a.png); }", /remote/],
      ['an @import', "@import 'assets/a.css';\n[data-theme='x'] { background: url(assets/a.png); }", /@import/],
      ['no selector', 'body { background: url(assets/a.png); }', /selector/],
    ])('refuses a pack with %s', async (_label, themeCss, message) => {
      const { fs } = memoryFs({ '/dl/x.zip': pack(themeCss) })
      await expect(importModFromPath('/dl/x.zip', 'zip', 'Themes', fs)).rejects.toThrow(message)
    })

    it('refuses an asset that is not what its extension says', async () => {
      const bad = zipSync({ 'theme.css': strToU8("[data-theme='x'] { background: url(assets/a.png); }"), 'assets/a.png': strToU8('<html>not a png</html>') })
      const { fs } = memoryFs({ '/dl/x.zip': bad })
      await expect(importModFromPath('/dl/x.zip', 'zip', 'Themes', fs)).rejects.toThrow(/not a valid PNG/)
    })

    it('refuses an svg asset that carries a script', async () => {
      const bad = zipSync({ 'theme.css': strToU8("[data-theme='x'] { background: url(assets/a.svg); }"), 'assets/a.svg': strToU8('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>') })
      const { fs } = memoryFs({ '/dl/x.zip': bad })
      await expect(importModFromPath('/dl/x.zip', 'zip', 'Themes', fs)).rejects.toThrow(/not a valid SVG/)
    })

    it.each(['theme-pack/../../evil.css', 'theme-pack/assets/..\\evil.png', 'theme-pack/assets/CON.png', 'theme-pack/assets/a\u202eb.png', '/abs/theme.css'])(
      'refuses the hostile entry name %j',
      async (name) => {
        const bad = zipSync({ 'theme-pack/theme.css': strToU8("[data-theme='x'] {}"), [name]: strToU8('x') })
        const { fs } = memoryFs({ '/dl/x.zip': bad })
        await expect(importModFromPath('/dl/x.zip', 'zip', 'Themes', fs)).rejects.toThrow(/Unsafe path/)
      },
    )

    it('refuses two assets that differ only by case', async () => {
      const bad = zipSync({ 'theme.css': strToU8("[data-theme='x'] {}"), 'assets/A.png': asset(PNG, 2500, 1), 'assets/a.png': asset(PNG, 2500, 2) })
      const { fs } = memoryFs({ '/dl/x.zip': bad })
      await expect(importModFromPath('/dl/x.zip', 'zip', 'Themes', fs)).rejects.toThrow(/Duplicate/)
    })

    it('still installs a plain exported .css and an old zip of loose css files', async () => {
      const built = buildThemeExport(plain, 'mine', 'Mine')
      const { fs, files } = memoryFs({ '/dl/mine.css': built.bytes, '/dl/old.zip': zipSync({ 'one.css': strToU8("[data-theme='one'] {}"), 'two.css': strToU8("[data-theme='two'] {}") }) })
      expect(await importModFromPath('/dl/mine.css', 'zip', 'Themes', fs)).toBe('mine')
      expect(text(files, '/Mods/Themes/mine.css')).toContain('/* @name: Mine */')
      await importModFromPath('/dl/old.zip', 'zip', 'Themes', fs)
      expect(files.has('/Mods/Themes/one.css') && files.has('/Mods/Themes/two.css')).toBe(true)
    })
  })
})

describe('exportTheme', () => {
  it('shows the save dialog and writes a .css; a cancelled dialog writes nothing', async () => {
    mocks.fs.readDir.mockResolvedValue([{ name: 'mine.css', isFile: true, isSymlink: false }])
    mocks.fs.readTextFile.mockResolvedValue("/* @name: Mine */\n[data-theme='mine'] { color: red; }")
    mocks.dialog.save.mockResolvedValueOnce(null)
    expect(await exportTheme('mine')).toBeNull()
    expect(mocks.fs.writeTextFile).not.toHaveBeenCalled()
    mocks.dialog.save.mockResolvedValueOnce('/out/mine.css')
    expect(await exportTheme('mine')).toBe('/out/mine.css')
    expect(mocks.dialog.save.mock.calls[1][0].defaultPath).toBe('mine.css')
    expect(mocks.fs.writeTextFile).toHaveBeenCalledWith('/out/mine.css', expect.stringContaining('/* @name: Mine */'))
  })

  it('writes a .zip when the theme embeds assets, and refuses links and unknown themes', async () => {
    const png = b64(asset(PNG, 3000, 5))
    mocks.fs.readDir.mockResolvedValue([{ name: 'mine.css', isFile: true, isSymlink: false }])
    mocks.fs.readTextFile.mockResolvedValue(`/* @name: Mine */\n[data-theme='mine'] { background: url(data:image/png;base64,${png}); }`)
    mocks.dialog.save.mockResolvedValueOnce('/out/mine.zip')
    await exportTheme('mine')
    expect(mocks.dialog.save.mock.calls[0][0].defaultPath).toBe('mine.zip')
    expect(Object.keys(unzipSync(mocks.fs.writeFile.mock.calls[0][1])).sort()).toEqual(['theme-pack/assets/image-1.png', 'theme-pack/theme.css'])

    mocks.fs.readDir.mockResolvedValue([{ name: 'mine.css', isFile: true, isSymlink: true }])
    await expect(exportTheme('mine')).rejects.toThrow(/regular/)
    mocks.fs.readDir.mockResolvedValue([])
    await expect(exportTheme('mine')).rejects.toThrow(/removed/)
    await expect(exportTheme('../mine')).rejects.toThrow(/Invalid/)
  })
})

describe('snippet packs', () => {
  const sn = (name: string, category: string) => ({ name, category, markdown: `Body of ${name}` })

  it('zips <Category>/<name>.md, deduplicating names ignoring case', () => {
    const pack = buildSnippetPack([sn('Goblin', 'Monsters'), sn('goblin', 'Monsters'), sn('Goblin', 'Monsters'), sn('Door', 'Places')])
    expect(pack.fileName).toBe('snippets-pack.zip')
    expect(Object.keys(unzipSync(pack.bytes)).sort()).toEqual(['Monsters/Goblin-3.md', 'Monsters/Goblin.md', 'Monsters/goblin-2.md', 'Places/Door.md'])
  })

  it.each(['../../x', '..\\x', 'CON', 'a/b', '\u202eevil', 'zero\u200bwidth', 'C:\\Windows'])('keeps entries inside safe folders for the hostile category %j', (category) => {
    const names = Object.keys(unzipSync(buildSnippetPack([sn('a', category)]).bytes))
    expect(names).toHaveLength(1)
    expect(names[0]).toMatch(/^[^/\\.:]+\/a\.md$/)
    expect(names[0]).not.toMatch(/[\u200b-\u200f\u202a-\u202e]/)
  })

  it('refuses an empty list and too many snippets', () => {
    expect(() => buildSnippetPack([])).toThrow(/at least one/)
    expect(() => buildSnippetPack(Array.from({ length: LIMITS.entries + 1 }, (_, i) => sn(`n${i}`, 'c')))).toThrow(/at most|holds/)
  })

  it('imports as one group per category, merging into existing groups without overwriting', async () => {
    const pack = buildSnippetPack([sn('Goblin', 'Monsters'), sn('Door', 'Places & Traps')])
    const { fs, files } = memoryFs({ '/dl/snippets-pack.zip': pack.bytes, '/Mods/Snippets/monsters/Goblin.md': strToU8('mine') })
    await importModFromPath('/dl/snippets-pack.zip', 'zip', 'Snippets', fs)
    expect(text(files, '/Mods/Snippets/monsters/Goblin.md')).toBe('mine')
    expect(text(files, '/Mods/Snippets/monsters/Goblin-2.md')).toContain('Body of Goblin')
    expect(text(files, '/Mods/Snippets/Places Traps/Door.md')).toContain('Body of Door')
    expect([...files.keys()].filter((path) => path.startsWith('/Mods')).some((path) => path.includes('snippets-pack'))).toBe(false)
  })

  it('imports a single-category pack as that category, not as the archive name', async () => {
    const pack = buildSnippetPack([sn('Goblin', 'Monsters'), sn('Orc', 'Monsters')])
    const { fs, files } = memoryFs({ '/dl/anything.zip': pack.bytes })
    expect(await importModFromPath('/dl/anything.zip', 'zip', 'Snippets', fs)).toBe('Monsters')
    expect(files.has('/Mods/Snippets/Monsters/Goblin.md') && files.has('/Mods/Snippets/Monsters/Orc.md')).toBe(true)
  })

  it('exports by catalog id, re-reading the library, and cancels cleanly', async () => {
    const library: Record<string, string> = { '/Mods/Snippets/Monsters/Goblin.md': '---\nsnippetName: Goblin\ntags: [Monsters]\n---\n<div data-type="section-break" data-columns="2"></div>\nStats\n' }
    mocks.fs.readDir.mockImplementation(async (path: string) => {
      if (path === '/Mods/Snippets') return [{ name: 'Monsters', isDirectory: true, isSymlink: false }]
      if (path === '/Mods/Snippets/Monsters') return [{ name: 'Goblin.md', isDirectory: false, isSymlink: false }]
      return []
    })
    mocks.fs.readTextFile.mockImplementation(async (path: string) => library[path])
    mocks.fs.stat.mockResolvedValue({ size: 100 })

    mocks.dialog.save.mockResolvedValueOnce(null)
    expect(await exportSnippetPack(['mod:Snippets/monsters/Goblin.md'])).toBeNull()
    mocks.dialog.save.mockResolvedValueOnce('/out/pack.zip')
    expect(await exportSnippetPack(['mod:Snippets/monsters/Goblin.md'])).toBe('/out/pack.zip')
    const zipped = unzipSync(mocks.fs.writeFile.mock.calls[0][1])
    expect(strFromU8(zipped['Monsters/Goblin.md'])).toBe('---\nsnippetName: Goblin\ntags: [Monsters]\n---\nStats\n')

    mocks.dialog.save.mockResolvedValueOnce('/out/Goblin.md')
    await exportSnippet('mod:Snippets/monsters/Goblin.md')
    expect(mocks.dialog.save.mock.calls[2][0].defaultPath).toBe('Goblin.md')
    expect(mocks.fs.writeTextFile).toHaveBeenCalledWith('/out/Goblin.md', expect.stringContaining('snippetName: Goblin'))
    await expect(exportSnippetPack(['mod:Snippets/monsters/../../x.md'])).rejects.toThrow()
  })

  it('packs a just-saved snippet as <Category>/<name>.md and keeps nothing when the dialog is cancelled', async () => {
    mocks.dialog.save.mockResolvedValueOnce(null)
    expect(await exportSnippetPackFrom([{ name: 'Orc Camp', category: 'Dungeons', markdown: 'Smoke' }])).toBeNull()
    expect(mocks.fs.writeFile).not.toHaveBeenCalled()
    mocks.dialog.save.mockResolvedValueOnce('/out/pack.zip')
    expect(await exportSnippetPackFrom([{ name: 'Orc Camp', category: '', markdown: 'Smoke' }])).toBe('/out/pack.zip')
    expect(mocks.dialog.save.mock.calls[1][0].defaultPath).toBe('snippets-pack.zip')
    const zipped = unzipSync(mocks.fs.writeFile.mock.calls[0][1])
    expect(Object.keys(zipped)).toEqual(['General/Orc-Camp.md'])
    expect(strFromU8(zipped['General/Orc-Camp.md'])).toBe('---\nsnippetName: Orc Camp\ntags: [General]\n---\nSmoke\n')
  })

  it('exports typed-in text through the save dialog', async () => {
    mocks.dialog.save.mockResolvedValueOnce('/out/x.md')
    await exportSnippet({ name: 'Note', category: 'Misc', markdown: 'Hello' })
    expect(mocks.fs.writeTextFile).toHaveBeenCalledWith('/out/x.md', '---\nsnippetName: Note\ntags: [Misc]\n---\nHello\n')
  })
})

describe('buildTemplateExport', () => {
  const root = 'C:/Users/me/Grimoires/Dragon Curse'
  const map = asset(PNG, 600, 9)
  const project = (): Record<string, string | Uint8Array> => ({
    'Draft/Chapter 1/Welcome.md': [
      '---', 'title: Welcome', 'zoom: 1.4', 'cursor: 12', 'cover: C:/Users/me/AppData/pic.jpg', 'theme: parchment', '---',
      '# Welcome',
      '',
      `![Map](${root}/Assets/Chapter 1/map.png)`,
      `![Encoded](C:/Users/me/Grimoires/Dragon%20Curse/Assets/Chapter%201/map.png)`,
      `![Map again](<${root}/Assets/Chapter 1/map.png> "Title")`,
      '[Next](../Chapter 2/Two.md) and [site](https://example.test/a) and [top](#welcome)',
      '[Outside](C:/Users/me/Desktop/secret.png) and [network](file://server/share/a.png)',
      `<img src="file:///${root}/Assets/Chapter 1/map.png" data-width-mm="40" />`,
      `<img src='C:\\Users\\me\\Desktop\\other.png'>`,
      `[ref]: ${root}/Assets/Chapter 1/map.png`,
      `<file:///C:/Users/me/x.png>`,
      '',
      '```',
      `![code](${root}/Assets/Chapter 1/map.png)`,
      '```',
      '',
      `Inline \`${root}/Assets/Chapter 1/map.png\` stays.`,
    ].join('\n'),
    'Draft/Chapter 2/Two.md': `# Two\n\n![up](../../Assets/Chapter 1/map.png)\n[escape](../../../outside.md)\n[notes](../../Research/Notes.txt) [abs notes](${root}/Research/Notes.txt)\n`,
    'Assets/Chapter 1/map.png': map,
    'Research/Notes.txt': 'notes',
    'Draft/Empty folder/': '',
  })

  const build = (files = project(), meta = {}) => buildTemplateExport(files, root, { name: 'Dragon Curse Base', author: 'JF', description: 'A base.\nTwo lines.', includeContent: true, ...meta })
  const unpack = (bytes: Uint8Array) => unzipSync(bytes)

  it('puts template.json at the zip root next to the project tree, and the importer accepts it', () => {
    const built = build()
    expect(built.fileName).toBe('dragon-curse-base.zip')
    const entries = unpack(built.bytes)
    // The tree is the content of Draft plus the project's Assets folder; Research does not travel.
    expect(Object.keys(entries).sort()).toEqual(['Assets/Chapter 1/map.png', 'Chapter 1/Welcome.md', 'Chapter 2/Two.md', 'template.json'])
    const manifest = JSON.parse(strFromU8(entries['template.json']))
    expect(Object.keys(manifest)).toEqual(['id', 'name', 'version', 'grimoireVersion', 'author', 'rootDirectory', 'description', 'structure'])
    expect(manifest).toMatchObject({ id: 'dragon-curse-base', name: 'Dragon Curse Base', version: '1.0.0', author: 'JF', rootDirectory: 'Draft', description: 'A base.\nTwo lines.' })
    expect(manifest.grimoireVersion).toMatch(/^>=\d+\.\d+\.\d+$/)
    expect(manifest.structure).toEqual(expect.arrayContaining([
      { path: 'Chapter 1/', type: 'directory' },
      { path: 'Chapter 1/Welcome.md', type: 'file' },
      { path: 'Assets/', type: 'directory' },
      { path: 'Assets/Chapter 1/map.png', type: 'file' },
      { path: 'Empty folder/', type: 'directory' },
    ]))
    expect(manifest.structure.some((entry: { path: string }) => /^(Draft|Research)\b/.test(entry.path))).toBe(false)
    const read = readTemplatePackage(built.bytes)
    expect(read.manifest?.id).toBe('dragon-curse-base')
    expect(read.files['template.json']).toBeUndefined()
  })

  it('makes absolute project paths relative to each file and neutralizes everything else, with warnings', () => {
    const built = build()
    const welcome = strFromU8(unpack(built.bytes)['Chapter 1/Welcome.md'])
    expect(welcome).toContain('![Map](../Assets/Chapter%201/map.png)')
    expect(welcome).toContain('![Map again](<../Assets/Chapter 1/map.png> "Title")')
    expect(welcome).toContain('<img src="../Assets/Chapter 1/map.png" data-width-mm="40" />')
    expect(welcome).toContain('[ref]: ../Assets/Chapter%201/map.png')
    expect(welcome).toContain('![Encoded](../Assets/Chapter%201/map.png)')
    expect(welcome).toContain('[Next](../Chapter 2/Two.md)')
    expect(welcome).toContain('https://example.test/a')
    expect(welcome).toContain('[top](#welcome)')
    expect(welcome).toContain('[Outside]() and [network]()')
    expect(welcome).toContain("<img src=\"\">")
    expect(welcome).not.toContain('<file:')
    // Code is never rewritten.
    expect(welcome).toContain(`![code](${root}/Assets/Chapter 1/map.png)`)
    expect(welcome).toContain(`\`${root}/Assets/Chapter 1/map.png\``)
    // No path of this computer remains outside code.
    expect(welcome.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '')).not.toMatch(/Users|C:/)
    expect(built.warnings.join('\n')).toMatch(/outside the project/)
    expect(built.warnings.join('\n')).toMatch(/front matter of "Chapter 1\/Welcome.md"/)
    // From Chapter 2/Two.md the shared Assets folder is one level up now; links into Research are removed with a warning.
    expect(strFromU8(unpack(built.bytes)['Chapter 2/Two.md'])).toBe('# Two\n\n![up](../Assets/Chapter 1/map.png)\n[escape]()\n[notes]() [abs notes]()\n')
    expect(built.warnings.join('\n')).toMatch(/part of the project the template does not include/)
    expect(built.warnings.join('\n')).toMatch(/not part of the template/)
  })

  it('removes volatile and local-path frontmatter lines and keeps the rest', () => {
    const welcome = strFromU8(unpack(build().bytes)['Chapter 1/Welcome.md'])
    expect(welcome.startsWith('---\ntitle: Welcome\ntheme: parchment\n---\n')).toBe(true)
    expect(VOLATILE_FRONTMATTER_KEYS).toContain('zoom')
  })

  it('structure only: every file keeps its path and frontmatter with an empty body; images are left out', () => {
    const built = build(project(), { includeContent: false })
    const entries = unpack(built.bytes)
    expect(Object.keys(entries).sort()).toEqual(['Chapter 1/Welcome.md', 'Chapter 2/Two.md', 'template.json'])
    expect(strFromU8(entries['Chapter 1/Welcome.md'])).toBe('---\ntitle: Welcome\ntheme: parchment\n---\n')
    expect(built.warnings.join('\n')).toMatch(/local path from the front matter/)
    expect(strFromU8(entries['Chapter 2/Two.md'])).toBe('')
    expect(readTemplatePackage(built.bytes).manifest?.name).toBe('Dragon Curse Base')
  })

  it('leaves out hidden, version-control and unsupported files silently', () => {
    const built = build({
      ...project(),
      '.git/config': 'x', '.cache/a.md': 'x', 'Draft/.hidden/a.md': 'x', '.grimoire-project.json': '{}', 'Draft/.undo.md': 'x',
      'notes.pdf': new Uint8Array([1]), 'macro.js': 'alert(1)', 'a.docx': new Uint8Array([1]), '__MACOSX/a.md': 'x',
    })
    expect(Object.keys(unpack(built.bytes)).sort()).toEqual(['Assets/Chapter 1/map.png', 'Chapter 1/Welcome.md', 'Chapter 2/Two.md', 'template.json'])
    expect(built.warnings.join('\n')).not.toMatch(/\.git|\.cache|pdf|macro/)
  })

  it('skips names the importer would refuse and case-only duplicates, with warnings, and the result still imports', () => {
    const built = build({
      'Draft/Good.md': 'ok',
      'Draft/CON.md': 'x', 'Draft/a:b.md': 'x', 'Draft/bidi\u202e.md': 'x', 'Draft/zero\u200bwidth.md': 'x', 'Draft/a<b>.md': 'x', 'Draft/q?.md': 'x',
      '../escape.md': 'x', '/abs.md': 'x', 'Draft/Dup.md': 'one', 'Draft/dup.md': 'two', [`Draft/${'x'.repeat(150)}.md`]: 'x',
      'Draft\\Win\\path.md': 'fine', 'Draft/style.css': "@import url('https://evil.test/x.css');",
    })
    const names = Object.keys(unpack(built.bytes)).sort()
    expect(names).toEqual(['Dup.md', 'Good.md', 'Win/path.md', 'template.json'])
    expect(built.warnings.length).toBeGreaterThanOrEqual(9)
    expect(() => readTemplatePackage(built.bytes)).not.toThrow()
  })

  it('needs a name and at least one document', () => {
    expect(() => build(project(), { name: ' \u200b ' })).toThrow(/name/)
    expect(() => build({ '.git/config': 'x' })).toThrow(/no documents/)
  })

  it('cannot inject into the manifest through the name, author or description', () => {
    const built = build(project(), { name: 'x", "evil": "1', author: 'a\u202eb\nc', description: 'd\u0000e' })
    const manifest = JSON.parse(strFromU8(unpack(built.bytes)['template.json']))
    expect(Object.keys(manifest)).not.toContain('evil')
    expect(manifest.id).toBe('x-evil-1')
    expect(manifest.author).toBe('ab c')
    expect(manifest.description).toBe('de')
    expect(() => readTemplatePackage(built.bytes)).not.toThrow()
  })

  it('fails with a plain message when the documents alone exceed the limits', () => {
    const many = Object.fromEntries(Array.from({ length: LIMITS.entries }, (_, i) => [`Draft/n${i}.md`, 'x']))
    expect(() => build(many)).toThrow(/too many or too large/)
    const big = 'a'.repeat(1024 * 1024)
    const huge = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`Draft/n${i}.md`, big]))
    expect(() => build(huge)).toThrow(/too many or too large/)
  })

  it('skips optional assets that do not fit, with warnings, and stays importable', () => {
    const files: Record<string, string | Uint8Array> = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`Draft/n${i}.md`, 'x']))
    for (let i = 0; i < 300; i++) files[`Assets/i${String(i).padStart(3, '0')}.png`] = asset(PNG, 16, i)
    files['Assets/huge.png'] = new Uint8Array(9 * 1024 * 1024)
    const built = build(files)
    const names = Object.keys(unpack(built.bytes))
    expect(names).toHaveLength(LIMITS.entries)
    expect(built.warnings.join('\n')).toMatch(/huge\.png": it is larger than 8 MiB/)
    expect(built.warnings.join('\n')).toMatch(/too many files/)
    expect(() => readTemplatePackage(built.bytes)).not.toThrow()
  })

  it('round-trips through Mod Manager import: the template appears with its files and no absolute path remains', async () => {
    const built = build()
    const { fs, files } = memoryFs({ '/dl/dragon-curse-base.zip': built.bytes })
    const id = await importModFromPath('/dl/dragon-curse-base.zip', 'zip', 'Templates', fs)
    expect(id).toBe('dragon-curse-base')
    const base = '/Mods/Templates/dragon-curse-base'
    expect([...files.keys()].filter((path) => path.startsWith(base)).map((path) => path.slice(base.length + 1)).sort()).toEqual([
      'Assets/Chapter 1/map.png', 'Chapter 1/Welcome.md', 'Chapter 2/Two.md', 'index.md',
    ])
    expect(text(files, `${base}/index.md`)).toContain('templateName: Dragon Curse Base')
    for (const [path, data] of files) {
      if (path.startsWith(base) && path.endsWith('.md')) expect(strFromU8(data).replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '')).not.toMatch(/C:\/|C:\\|Users/)
    }
    expect(Array.from(files.get(`${base}/Assets/Chapter 1/map.png`)!)).toEqual(Array.from(map))
  })
  it('exports a project without a Draft folder whole, named after the project folder', () => {
    const built = build({ 'Chapters/One.md': '# One\n![m](Maps/m.png)', 'Maps/m.png': map, 'Notes.md': 'n' })
    expect(Object.keys(unpack(built.bytes)).sort()).toEqual(['Chapters/One.md', 'Maps/m.png', 'Notes.md', 'template.json'])
    const manifest = JSON.parse(strFromU8(unpack(built.bytes)['template.json']))
    expect(manifest.rootDirectory).toBe('Dragon Curse')
    expect(strFromU8(unpack(built.bytes)['Chapters/One.md'])).toContain('![m](Maps/m.png)')
  })

  it('keeps Draft content ahead of Assets on a name clash and ignores letter case of Draft/Assets', () => {
    const built = build({ 'draft/a.md': '# a', 'draft/Assets/x.png': asset(PNG, 20, 1), 'ASSETS/x.png': asset(PNG, 20, 2), 'Research/r.md': 'r' })
    expect(Object.keys(unpack(built.bytes)).sort()).toEqual(['Assets/x.png', 'a.md', 'template.json'])
    expect(Array.from(unpack(built.bytes)['Assets/x.png'])).toEqual(Array.from(asset(PNG, 20, 1)))
    expect(built.warnings.join('\n')).toMatch(/differs from it only by letter case/)
  })

  it('does not leak absolute paths written percent-encoded, in srcset, poster, data-src, anchors, sources or UNC form', () => {
    const doc = [
      '![a](C:%5CUsers%5CBob%20Smith%5Cx.png)',
      '![b](c:%2FUsers%2FBob%2Fy.png)',
      '![c](C%3A%5CUsers%5CBob%5Cz.png)',
      '![d](C:%255CUsers%255CBob%255Cw.png)',
      '![e](\\server\share\Bob\q.png)',
      '![f](file:%2F%2F%2FC:%2FUsers%2FBob%2Fr.png)',
      '<img srcset="C:/Users/Bob/x.png 1x, D:\\Users\\Bob\\x2.png 2x, ../Assets/ok.png 3x" src="d:/Users/Bob/s.png">',
      "<img srcset='C:/Users/Bob Smith/x.png 1x'>",
      '<video poster="C:\\Users\\Bob\\p.png"></video>',
      '<img data-src="c:/Users/Bob/d.png">',
      '<a href="C:%5CUsers%5CBob%5Ca.pdf">link</a>',
      '<link href="file:///C:/Users/Bob/s.css">',
      '<picture><source src="C:/Users/Bob/v.webm" srcset="/Users/Bob/h.png 1x"></picture>',
      '<C:%5CUsers%5CBob%5Cauto.png>',
    ].join('\n')
    const built = build({ 'Draft/One.md': `---\ncover: C:%5CUsers%5CBob%5Ccover.png\n---\n${doc}\n`, 'Assets/ok.png': map })
    const entries = unpack(built.bytes)
    const all = Object.values(entries).map((bytes) => strFromU8(bytes)).join('\n')
    expect(all).not.toMatch(/Users|Bob|Smith|server|share|C:|D:|%5C|%2F/i)
    const one = strFromU8(entries['One.md'])
    expect(one).toContain('./Assets/ok.png 3x')
    expect(one).toContain('srcset="./Assets/ok.png 3x"')
    expect(built.warnings.length).toBeGreaterThan(5)
  })

  it('round-trips export, import, listing and apply: project layout needs a project and keeps image links working', async () => {
    const built = build()
    const { fs, files } = memoryFs({ '/dl/dragon-curse-base.zip': built.bytes })
    await importModFromPath('/dl/dragon-curse-base.zip', 'zip', 'Templates', fs)
    mocks.fs.readDir.mockImplementation(async (path: string) => (await fs.readDir(path)).map((e) => ({ ...e, isSymlink: false })))
    mocks.fs.stat.mockImplementation(async (path: string) => ({ size: files.get(path)?.length ?? 0 }))
    mocks.fs.readTextFile.mockImplementation(async (path: string) => text(files, path))
    const { loadUserTemplates } = await import('./templates')
    const listed = await loadUserTemplates(new Set(), { dir: '/Mods/Templates', reservedIds: [] })
    const template = listed.templates.find((item) => item.id === 'dragon-curse-base')!
    expect(template.layout).toBe('project')
    expect(template.requiresProject).toBe(true)

    // Applying into a project: Draft/<id>/Chapter 1/... and Draft/<id>/Assets/... with links that still resolve.
    const { createTemplateDocuments } = await import('./templateIo')
    const target = new Map<string, Uint8Array>()
    const folders = new Set<string>(['/proj/Draft'])
    const projectFs: ProjectPackageFs = {
      readFile: async (path) => (files.get(path) ?? target.get(path)) as Uint8Array,
      writeFile: async (path, data) => { target.set(path, data) },
      mkdir: async (path) => { folders.add(path) },
      exists: async (path) => folders.has(path) || target.has(path),
      readDir: (path) => fs.readDir(path),
      rename: async (from, to) => {
        for (const [path, data] of [...target]) if (path.startsWith(`${from}/`)) { target.delete(path); target.set(`${to}${path.slice(from.length)}`, data) }
        folders.add(to)
      },
      removeDir: async () => undefined,
    }
    await createTemplateDocuments(projectFs, '/proj/Draft', template)
    const welcome = strFromU8(target.get('/proj/Draft/dragon-curse-base/Chapter 1/Welcome.md')!)
    expect([...target.keys()]).toContain('/proj/Draft/dragon-curse-base/Assets/Chapter 1/map.png')
    expect([...target.keys()].some((path) => path.includes('/Draft/dragon-curse-base/Draft/'))).toBe(false)
    // "../Assets/Chapter%201/map.png" from Chapter 1/ lands on Assets/Chapter 1/map.png next to it.
    expect(welcome).toContain('![Map](../Assets/Chapter%201/map.png)')
  })
})

describe('readProjectTree and exportProjectAsTemplate', () => {
  const tree: Record<string, { name: string; isDirectory: boolean; isSymlink?: boolean }[]> = {
    '/proj': [
      { name: 'Draft', isDirectory: true }, { name: '.git', isDirectory: true }, { name: 'link', isDirectory: true, isSymlink: true },
      { name: 'Empty', isDirectory: true }, { name: 'a.pdf', isDirectory: false }, { name: 'logo.png', isDirectory: false }, { name: 'big.png', isDirectory: false },
    ],
    '/proj/Draft': [{ name: 'One.md', isDirectory: false }, { name: '.hidden.md', isDirectory: false }, { name: 'sym.md', isDirectory: false, isSymlink: true }],
    '/proj/Empty': [],
  }
  const reader = {
    readDir: vi.fn(async (path: string) => tree[path] ?? (() => { throw new Error(`unexpected ${path}`) })()),
    readFile: vi.fn(async (path: string) => strToU8(`content of ${path}`)),
    stat: vi.fn(async (path: string) => ({ size: path.endsWith('big.png') ? 9 * 1024 * 1024 : 10 })),
  }

  it('reads only visible, real, supported files and reports what it left out', async () => {
    const { files, notes } = await readProjectTree(reader, '/proj/')
    expect(Object.keys(files).sort()).toEqual(['Draft/One.md', 'Empty/', 'logo.png'])
    expect(notes.join('\n')).toMatch(/big\.png.*8 MiB/)
    expect(notes.join('\n')).toMatch(/other types.*pdf/)
    const read = reader.readFile.mock.calls.map(([path]) => path)
    expect(read.some((path) => /\.git|link|hidden|sym|a\.pdf|big/.test(path))).toBe(false)
  })

  it('exports the open project through the save dialog and returns the path with warnings', async () => {
    useDocumentStore.getState().setWorkspace('/proj', [])
    mocks.fs.readDir.mockImplementation(async (path: string) => tree[path])
    mocks.fs.stat.mockImplementation(async (path: string) => ({ size: path.endsWith('big.png') ? 9 * 1024 * 1024 : 10 }))
    mocks.fs.readFile.mockImplementation(async (path: string) => strToU8(`content of ${path}`))
    mocks.dialog.save.mockResolvedValueOnce(null)
    expect(await exportProjectAsTemplate({ name: 'Mine', includeContent: true })).toBeNull()
    expect(mocks.fs.writeFile).not.toHaveBeenCalled()
    mocks.dialog.save.mockResolvedValueOnce('/out/mine.zip')
    const result = await exportProjectAsTemplate({ name: 'Mine', includeContent: true })
    expect(result?.path).toBe('/out/mine.zip')
    expect(mocks.dialog.save.mock.calls[1][0].defaultPath).toBe('mine.zip')
    expect(Object.keys(unzipSync(mocks.fs.writeFile.mock.calls[0][1])).sort()).toEqual(['One.md', 'template.json'])
  })

  it('needs an open project', async () => {
    useDocumentStore.getState().setWorkspace(null, [])
    await expect(exportProjectAsTemplate({ name: 'Mine', includeContent: true })).rejects.toThrow(/Open a project/)
  })
})
