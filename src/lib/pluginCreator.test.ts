import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listExternalPlugins: vi.fn(),
  loadLibraryPaths: vi.fn(),
}))
vi.mock('./externalPlugins', () => ({ listExternalPlugins: mocks.listExternalPlugins }))
vi.mock('./preferences', () => ({ loadLibraryPaths: mocks.loadLibraryPaths }))
vi.mock('@tauri-apps/plugin-fs', () => ({}))

import {
  buildPluginPackage, createPluginFromInput, firstPluginError, hasPluginErrors, slugify, validatePluginInput,
  type PluginFs, type PluginInput,
} from './pluginCreator'

const MARKDOWN = '## Encounter\n\n| d6 | Result |\n| --- | --- |\n| 1 | Goblins |\n'
const fixtureInput: PluginInput = {
  name: 'Encounter Tools',
  author: 'Test Author',
  description: 'Buttons that insert encounter tables.',
  buttons: [{ label: 'Encounter table', markdown: MARKDOWN }],
}
const fixtureText = readFileSync(resolve(process.cwd(), 'src/lib/fixtures/insert-plugin.manifest.json'), 'utf8')

const withMarkdown = (markdown: string): PluginInput => ({ name: 'P', buttons: [{ label: 'B', markdown }] })
const markdownError = (markdown: string) => validatePluginInput(withMarkdown(markdown)).items[0].markdown

describe('buildPluginPackage', () => {
  it('produces the shared fixture manifest', () => {
    const pack = buildPluginPackage(fixtureInput)
    const text = pack.files['manifest.json']
    expect(JSON.parse(text)).toEqual(JSON.parse(fixtureText))
    expect(JSON.parse(text)).toEqual(JSON.parse(JSON.stringify(JSON.parse(text))))
    expect(pack.id).toBe('custom.encounter-tools')
    expect(pack.folder).toBe('encounter-tools')
  })

  it('keeps the fixture key order, two-space JSON and a trailing newline', () => {
    const text = buildPluginPackage(fixtureInput).files['manifest.json']
    expect(text.endsWith('}\n')).toBe(true)
    expect(text.startsWith('{\n  "schemaVersion": 1,\n  "sdkVersion": 2,\n  "id"')).toBe(true)
    const manifest = JSON.parse(text)
    expect(Object.keys(manifest)).toEqual(Object.keys(JSON.parse(fixtureText)))
    expect(Object.keys(manifest.contributions.toolbar[0])).toEqual(['id', 'type', 'label', 'action'])
    expect(Object.keys(manifest.contributions.toolbar[0].action)).toEqual(['type', 'markdown'])
    expect(text).toBe(`${JSON.stringify(manifest, null, 2)}\n`)
  })

  it('applies the defaults, numbers the buttons and asks only for editor:insert', () => {
    const pack = buildPluginPackage({ name: '  Tools ', buttons: [{ label: ' A ', markdown: 'a' }, { label: 'B', markdown: 'b' }] })
    const manifest = JSON.parse(pack.files['manifest.json'])
    expect(manifest).toMatchObject({ name: 'Tools', author: 'Unknown', description: 'Inserts text with buttons.', version: '1.0.0', main: 'dist/index.js', permissions: ['editor:insert'] })
    expect(manifest.contributions.toolbar.map((item: { id: string; label: string }) => [item.id, item.label])).toEqual([['insert-1', 'A'], ['insert-2', 'B']])
  })

  it('writes a comment-only entry file and a tutorial with frontmatter', () => {
    const files = buildPluginPackage(fixtureInput).files
    const lines = files['dist/index.js'].trim().split('\n')
    expect(lines).toHaveLength(1)
    expect(lines[0].startsWith('//')).toBe(true)
    expect(lines[0]).toContain('manifest.json')
    expect(files['index.md']).toMatch(/^---\npluginName: Encounter Tools\npluginId: custom\.encounter-tools\npluginDescription: .+\n---\n/)
    expect(files['index.md']).toContain('Refresh')
    expect(files['index.md']).toContain('cannot read your pages')
  })

  it('makes ids and folders unique with -2, -3 suffixes, ignoring case', () => {
    const pack = buildPluginPackage(fixtureInput, { existingIds: ['custom.encounter-tools', 'custom.encounter-tools-2'], existingFolders: ['Encounter-Tools'] })
    expect(pack.id).toBe('custom.encounter-tools-3')
    expect(pack.folder).toBe('encounter-tools-2')
  })

  it('refuses invalid input', () => {
    expect(() => buildPluginPackage({ name: '', buttons: [] })).toThrow('Enter a plugin name.')
  })
})

describe('slugify', () => {
  it('lowercases, drops accents and collapses separators', () => {
    expect(slugify('Encounter Tools')).toBe('encounter-tools')
    expect(slugify('Ñandú  Éxito!!')).toBe('nandu-exito')
    expect(slugify('--a__b--')).toBe('a-b')
  })
  it('falls back to plugin for emoji or symbols only', () => {
    expect(slugify('🎲🎲')).toBe('plugin')
    expect(slugify('!!!')).toBe('plugin')
    expect(slugify('')).toBe('plugin')
  })
  it('limits the length to 40 without a trailing hyphen', () => {
    const slug = slugify(`${'a'.repeat(39)} bbbbbb`)
    expect(slug.length).toBeLessThanOrEqual(40)
    expect(slug.endsWith('-')).toBe(false)
    expect(slugify('x'.repeat(100))).toHaveLength(40)
  })
  it('adds -plugin to Windows device names', () => {
    for (const name of ['con', 'CON', 'nul', 'Aux', 'prn', 'com1', 'lpt9']) expect(slugify(name)).toBe(`${name.toLowerCase()}-plugin`)
    expect(slugify('console')).toBe('console')
    expect(slugify('com10')).toBe('com10')
  })
})

describe('validatePluginInput', () => {
  const ok = (input: PluginInput) => expect(hasPluginErrors(validatePluginInput(input))).toBe(false)
  it('accepts the fixture input', () => ok(fixtureInput))

  it('checks the name', () => {
    expect(validatePluginInput({ name: '', buttons: fixtureInput.buttons }).name).toBe('Enter a plugin name.')
    expect(validatePluginInput({ name: '   ', buttons: fixtureInput.buttons }).name).toBeDefined()
    expect(validatePluginInput({ name: 'a'.repeat(65), buttons: fixtureInput.buttons }).name).toContain('64')
    ok({ name: 'a'.repeat(64), buttons: fixtureInput.buttons })
    for (const bad of ['a\u0000b', 'a\nb', 'a\u200bb', 'a\u202eb', 'a\ufeffb']) {
      expect(validatePluginInput({ name: bad, buttons: fixtureInput.buttons }).name, JSON.stringify(bad)).toContain('invisible')
    }
  })

  it('checks author and description lengths', () => {
    expect(validatePluginInput({ ...fixtureInput, author: 'a'.repeat(65) }).author).toContain('64')
    expect(validatePluginInput({ ...fixtureInput, description: 'd'.repeat(281) }).description).toContain('280')
    ok({ ...fixtureInput, author: 'a'.repeat(64), description: 'd'.repeat(280) })
    expect(validatePluginInput({ ...fixtureInput, description: 'a\tb' }).description).toBeDefined()
  })

  it('needs between 1 and 12 buttons', () => {
    expect(validatePluginInput({ name: 'P', buttons: [] }).buttons).toBe('Add at least one button.')
    const many = Array.from({ length: 13 }, () => ({ label: 'B', markdown: 'm' }))
    expect(validatePluginInput({ name: 'P', buttons: many }).buttons).toContain('12')
    ok({ name: 'P', buttons: many.slice(0, 12) })
  })

  it('checks the button label', () => {
    const label = (value: string) => validatePluginInput({ name: 'P', buttons: [{ label: value, markdown: 'm' }] }).items[0].label
    expect(label('')).toBeDefined()
    expect(label('x'.repeat(41))).toContain('40')
    expect(label('x'.repeat(40))).toBeUndefined()
    expect(label('a\u200db')).toBeDefined()
    expect(label('a\nb')).toBeDefined()
  })

  it('checks the markdown length and characters', () => {
    expect(markdownError('')).toBe('Enter the text this button inserts.')
    expect(markdownError('x'.repeat(8193))).toContain('8192')
    expect(markdownError('x'.repeat(8192))).toBeUndefined()
    expect(markdownError('line\r\nnext\ttab\n')).toBeUndefined()
    for (const bad of ['a\u0000b', 'a\u0007b', 'a\u200bb', 'a\u202eb', 'a\u2066b', 'a\u007fb']) {
      expect(markdownError(bad), JSON.stringify(bad)).toContain('invisible')
    }
  })

  it('reports one entry per button, in order', () => {
    const result = validatePluginInput({ name: 'P', buttons: [{ label: 'A', markdown: 'ok' }, { label: '', markdown: 'ok' }] })
    expect(result.items).toEqual([{}, { label: expect.any(String) }])
    expect(firstPluginError(result)).toBe('Enter a button label.')
  })

  it('accepts relative links, anchors and plain markdown', () => {
    for (const fine of ['[a](notes/page.md)', '[top](#top)', '![map](images/map.png)', '**bold** `code` > quote', '<b>bold</b> <br>', 'a // comment mid-line', '[x](../up.md)']) {
      expect(markdownError(fine), fine).toBeUndefined()
    }
  })

  it.each([
    ['http link', '[a](http://x.test)'],
    ['https image', '![a](https://x.test/i.png)'],
    ['ftp', '[a](ftp://x.test)'],
    ['uppercase scheme', '[a](HTTP://X)'],
    ['mixed case https', 'See HtTpS://x'],
    ['protocol-relative link', '[a](//x.test/a)'],
    ['protocol-relative with space', '[a]( //x.test/a)'],
    ['protocol-relative html', '<a href="//x.test">a</a>'],
    ['protocol-relative reference', '[a]: //x.test'],
    ['backslash protocol-relative', '[a](\\\\x.test)'],
    ['data uri', '![a](data:image/png;base64,AAAA)'],
    ['file uri', '[a](file:///C:/x)'],
    ['javascript uri', '[a](javascript:alert(1))'],
    ['vbscript uri', '[a](vbscript:x)'],
    ['decimal entity', '[a](&#104;ttp://x)'],
    ['hex entity', '[a](&#x68;ttp://x)'],
    ['entity in javascript', '[a](jav&#x61;script:alert(1))'],
    ['entity colon', '[a](http&colon;//x)'],
    ['percent encoded', '[a](%68ttp://x)'],
    ['percent encoded colon', '[a](http%3A//x)'],
    ['double encoded', '[a](%2568ttp://x)'],
    ['tab inside scheme', '[a](java\tscript:x)'],
    ['script tag', '<script>alert(1)</script>'],
    ['uppercase script', '<SCRIPT src=x>'],
    ['iframe', '<iframe src="x"></iframe>'],
    ['object', '<object data="x">'],
    ['embed', '<embed src="x">'],
    ['link tag', '<link rel="stylesheet" href="x.css">'],
    ['meta', '<META http-equiv="refresh">'],
    ['style', '<style>a{}</style>'],
    ['base', '<base href="x">'],
    ['form', '<Form action="x">'],
    ['spaced tag', '<  script>x'],
    ['encoded tag', '&lt;script&gt;x'],
    ['numeric encoded tag', '&#60;iframe src=x>'],
    ['onclick', '<a onclick="x()">a</a>'],
    ['onerror uppercase', '<img src=x ONERROR=alert(1)>'],
    ['onload spaced', '<body onload = x>'],
    ['encoded handler', '<img src=x on&#101;rror=y>'],
  ])('rejects %s', (_label, markdown) => {
    expect(markdownError(markdown), markdown).toBeTruthy()
  })
})

/* ---- createPluginFromInput ------------------------------------------------------------------ */

function memoryFs(options: { failOn?: RegExp; folders?: Record<string, string> } = {}) {
  const dirs = new Set<string>(['/lib'])
  const files = new Map<string, string>()
  for (const [folder, id] of Object.entries(options.folders ?? {})) {
    dirs.add(`/lib/${folder}`)
    files.set(`/lib/${folder}/manifest.json`, JSON.stringify({ id }))
  }
  const calls: string[] = []
  const io: PluginFs = {
    exists: async (path) => dirs.has(path) || files.has(path),
    mkdir: async (path) => {
      const parts = path.split('/')
      for (let i = 2; i <= parts.length; i++) dirs.add(parts.slice(0, i).join('/'))
    },
    readDir: async (path) => {
      const names = new Set<string>()
      for (const entry of [...dirs, ...files.keys()]) {
        if (entry.startsWith(`${path}/`) && entry !== path) names.add(entry.slice(path.length + 1).split('/')[0])
      }
      return [...names].map((name) => ({ name, isDirectory: dirs.has(`${path}/${name}`), isSymlink: false }))
    },
    readTextFile: async (path) => {
      const text = files.get(path)
      if (text === undefined) throw new Error('missing')
      return text
    },
    stat: async () => ({ size: 0 }),
    writeTextFile: async (path, text) => {
      calls.push(path)
      if (options.failOn?.test(path)) throw new Error('disk full')
      if (files.has(path)) throw new Error('exists')
      files.set(path, text)
    },
    remove: async (path) => {
      for (const dir of [...dirs]) if (dir === path || dir.startsWith(`${path}/`)) dirs.delete(dir)
      for (const file of [...files.keys()]) if (file.startsWith(`${path}/`)) files.delete(file)
    },
  }
  return { io, dirs, files, calls }
}

describe('createPluginFromInput', () => {
  beforeEach(() => {
    mocks.loadLibraryPaths.mockReset().mockResolvedValue({ plugins: '/lib' })
    mocks.listExternalPlugins.mockReset().mockResolvedValue({ version: 1, disabledAll: false, plugins: {} })
  })

  it('writes the package into the Plugins library and returns where', async () => {
    const fs = memoryFs()
    const result = await createPluginFromInput(fixtureInput, fs.io)
    expect(result).toEqual({ folder: 'encounter-tools', id: 'custom.encounter-tools', path: '/lib/encounter-tools' })
    expect([...fs.files.keys()].sort()).toEqual(['/lib/encounter-tools/dist/index.js', '/lib/encounter-tools/index.md', '/lib/encounter-tools/manifest.json'])
    expect(JSON.parse(fs.files.get('/lib/encounter-tools/manifest.json')!)).toEqual(JSON.parse(fixtureText))
  })

  it('writes the manifest last', async () => {
    const fs = memoryFs()
    await createPluginFromInput(fixtureInput, fs.io)
    expect(fs.calls.at(-1)).toBe('/lib/encounter-tools/manifest.json')
    expect(fs.calls).toHaveLength(3)
  })

  it('creates the library folder when it is missing', async () => {
    const fs = memoryFs()
    fs.dirs.delete('/lib')
    await createPluginFromInput(fixtureInput, fs.io)
    expect(fs.dirs.has('/lib')).toBe(true)
  })

  it('never overwrites: a taken folder gets -2, then -3, and the id stays unique', async () => {
    const fs = memoryFs({ folders: { 'encounter-tools': 'custom.encounter-tools' } })
    const second = await createPluginFromInput(fixtureInput, fs.io)
    expect(second).toMatchObject({ folder: 'encounter-tools-2', id: 'custom.encounter-tools-2' })
    const third = await createPluginFromInput(fixtureInput, fs.io)
    expect(third).toMatchObject({ folder: 'encounter-tools-3', id: 'custom.encounter-tools-3' })
    expect(JSON.parse(fs.files.get('/lib/encounter-tools/manifest.json')!)).toEqual({ id: 'custom.encounter-tools' })
  })

  it('treats a folder name taken ignoring case as taken', async () => {
    const fs = memoryFs({ folders: { 'Encounter-Tools': 'other.id' } })
    const result = await createPluginFromInput(fixtureInput, fs.io)
    expect(result.folder).toBe('encounter-tools-2')
    expect(result.id).toBe('custom.encounter-tools')
  })

  it('keeps ids unique against the managed registry', async () => {
    mocks.listExternalPlugins.mockResolvedValue({ version: 1, disabledAll: false, plugins: { 'custom.encounter-tools': {} } })
    const result = await createPluginFromInput(fixtureInput, memoryFs().io)
    expect(result.id).toBe('custom.encounter-tools-2')
    expect(result.folder).toBe('encounter-tools')
  })

  it('still works when the registry cannot be read', async () => {
    mocks.listExternalPlugins.mockRejectedValue(new Error('offline'))
    await expect(createPluginFromInput(fixtureInput, memoryFs().io)).resolves.toMatchObject({ id: 'custom.encounter-tools' })
  })

  it('removes only its own new folder when a write fails, and the failure surfaces', async () => {
    const fs = memoryFs({ failOn: /manifest\.json$/, folders: { other: 'x.other' } })
    await expect(createPluginFromInput(fixtureInput, fs.io)).rejects.toThrow('disk full')
    expect(fs.dirs.has('/lib/encounter-tools')).toBe(false)
    expect([...fs.files.keys()].filter((path) => path.startsWith('/lib/encounter-tools'))).toEqual([])
    expect(fs.dirs.has('/lib/other')).toBe(true)
    expect(fs.files.has('/lib/other/manifest.json')).toBe(true)
  })

  it('cleans up when the first write fails', async () => {
    const fs = memoryFs({ failOn: /dist\/index\.js$/ })
    await expect(createPluginFromInput(fixtureInput, fs.io)).rejects.toThrow('disk full')
    expect(fs.dirs.has('/lib/encounter-tools')).toBe(false)
  })

  it('rejects invalid input before touching the disk', async () => {
    const fs = memoryFs()
    await expect(createPluginFromInput({ name: 'P', buttons: [{ label: 'B', markdown: '[x](http://a)' }] }, fs.io)).rejects.toThrow(/not allowed/)
    expect(fs.calls).toEqual([])
  })
})
