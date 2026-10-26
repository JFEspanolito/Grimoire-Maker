import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import {
  APP_VERSION,
  LIMITS,
  PackageError,
  cleanLine,
  createTemplateZip,
  isSafePackagePath,
  packageIdFromFileName,
  parseTemplateManifest,
  readTemplatePackage,
  readTemplateZip,
  sanitizePathSegment,
  slugify,
  yamlScalar,
} from './templatePackage'

const text = (value: string): Uint8Array => strToU8(value)
const zip = (files: Record<string, string | Uint8Array>): Uint8Array =>
  zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, typeof v === 'string' ? text(v) : v])))

const INDEX = '---\ntitle: Test\n---\n# Hello\n'

describe('readTemplateZip: layout', () => {
  it('reads a package whose files sit at the zip root', () => {
    const files = readTemplateZip(
      zip({ 'index.md': INDEX, 'theme.css': "[data-theme='x'] {}", 'chapters/one.md': '# One' }),
    )
    expect(Object.keys(files).sort()).toEqual(['chapters/one.md', 'index.md', 'theme.css'])
  })

  it('unwraps a single top-level folder, as made by zipping a folder', () => {
    const files = readTemplateZip(zip({ 'my-adventure/index.md': INDEX, 'my-adventure/chapters/a.md': '# A' }))
    expect(Object.keys(files).sort()).toEqual(['chapters/a.md', 'index.md'])
  })

  it('ignores hidden files and macOS archive junk', () => {
    const files = readTemplateZip(
      zip({ 'index.md': INDEX, '.DS_Store': 'x', '__MACOSX/._index.md': 'x', 'assets/.hidden.png': 'x' }),
    )
    expect(Object.keys(files)).toEqual(['index.md'])
  })

  it('requires an index.md', () => {
    expect(() => readTemplateZip(zip({ 'chapters/one.md': '# One' }))).toThrow(/index\.md/)
  })

  it('round-trips through createTemplateZip', () => {
    const original = { 'index.md': text(INDEX), 'assets/map.png': new Uint8Array([1, 2, 3, 250]) }
    const read = readTemplateZip(createTemplateZip(original))
    expect(Object.keys(read).sort()).toEqual(['assets/map.png', 'index.md'])
    expect(Array.from(read['assets/map.png'])).toEqual([1, 2, 3, 250])
  })
})

describe('readTemplateZip: untrusted input', () => {
  it.each([
    ['parent traversal', '../evil.md'],
    ['nested traversal', 'chapters/../../evil.md'],
    ['absolute path', '/etc/evil.md'],
    ['drive letter', 'C:/evil.md'],
    ['backslash separator', 'chapters\\evil.md'],
  ])('rejects %s', (_label, name) => {
    expect(() => readTemplateZip(zip({ 'index.md': INDEX, [name]: '# x' }))).toThrow(PackageError)
  })

  it('rejects file types that are not documents, styles or images', () => {
    expect(() => readTemplateZip(zip({ 'index.md': INDEX, 'run.exe': 'MZ' }))).toThrow(/run\.exe/)
  })

  it.each([
    ['remote @import', "@import url('https://evil.example/x.css');"],
    ['remote url()', "[data-theme='x'] { background: url(https://evil.example/p.png); }"],
    ['protocol-relative url()', "[data-theme='x'] { background: url(//evil.example/p.png); }"],
  ])('rejects a stylesheet with %s', (_label, css) => {
    expect(() => readTemplateZip(zip({ 'index.md': INDEX, 'theme.css': css }))).toThrow(/theme\.css/)
  })

  it('accepts a stylesheet that only references local assets', () => {
    const css = "[data-theme='x'] { background: url(assets/bg.png); }"
    expect(() => readTemplateZip(zip({ 'index.md': INDEX, 'theme.css': css, 'assets/bg.png': 'x' }))).not.toThrow()
  })

  it('rejects data that is not a zip archive', () => {
    expect(() => readTemplateZip(text('this is not a zip file'))).toThrow(PackageError)
  })

  it('rejects an archive with too many entries', () => {
    const files: Record<string, string> = { 'index.md': INDEX }
    for (let i = 0; i < LIMITS.entries; i++) files[`chapters/c${i}.md`] = '# x'
    expect(() => readTemplateZip(zip(files))).toThrow(/too many/i)
  })

  it('rejects an archive that inflates past the size limit (zip bomb)', () => {
    const bomb = zip({ 'index.md': INDEX, 'assets/big.png': new Uint8Array(LIMITS.totalBytes + 1024 * 1024) })
    expect(bomb.length).toBeLessThan(200 * 1024)
    expect(() => readTemplateZip(bomb)).toThrow(/too large/i)
  })
})

describe('packageIdFromFileName', () => {
  it('turns a zip name into a safe id', () => {
    expect(packageIdFromFileName('My Adventure (v2).zip', new Set())).toBe('My-Adventure-v2')
  })

  it('avoids ids that are already taken', () => {
    expect(packageIdFromFileName('zine.zip', new Set(['zine', 'zine-1']))).toBe('zine-2')
  })

  it('falls back to a default for an unusable name', () => {
    expect(packageIdFromFileName('???.zip', new Set())).toBe('template')
  })
})

describe('readTemplateZip: Windows-specific names', () => {
  it.each([
    ['a reserved device name', 'con.md'],
    ['a reserved device name with a folder', 'assets/NUL.png'],
    ['a reserved name with a numbered port', 'chapters/com1.md'],
    ['a name ending in a dot', 'chapters/one.md.'],
    ['a folder ending in a space', 'chapters /one.md'],
    ['characters Windows forbids in names', 'chapters/a?b.md'],
    ['a control character in the name', 'chapters/a\u0001b.md'],
    ['an over-long name', `chapters/${'a'.repeat(150)}.md`],
  ])('rejects %s', (_label, name) => {
    expect(() => readTemplateZip(zip({ 'index.md': INDEX, [name]: '# x' }))).toThrow(PackageError)
  })

  it('rejects two entries that differ only by letter case, which collide on Windows and macOS', () => {
    expect(() => readTemplateZip(zip({ 'index.md': INDEX, 'chapters/One.md': '# a', 'chapters/one.md': '# b' }))).toThrow(
      /duplicate/i,
    )
  })

  it('still accepts ordinary names that merely contain a reserved word', () => {
    expect(() =>
      readTemplateZip(zip({ 'index.md': INDEX, 'chapters/console-notes.md': '# x', 'assets/auxiliary.png': 'x' })),
    ).not.toThrow()
  })
})

describe('readTemplateZip: bounded memory on a size bomb', () => {
  it('stops inflating shortly after the limit instead of unpacking the whole bomb', () => {
    const limits = { entries: 500, totalBytes: 1024 * 1024 }
    const bomb = zip({ 'index.md': INDEX, 'assets/big.png': new Uint8Array(100 * 1024 * 1024) })
    const stats = { inflated: 0 }
    expect(() => readTemplateZip(bomb, { limits, stats })).toThrow(/too large/i)
    // Input is fed in small slices, so overshoot is a few MB at most, not the full 100 MB.
    expect(stats.inflated).toBeLessThan(limits.totalBytes + 16 * 1024 * 1024)
  })
})

describe('readTemplateZip: structural edge cases', () => {
  it.each([
    ['a file whose whole name is an allowed extension', 'css'],
    ['a name with a bidirectional control character', 'chapters/a\u202Eb.md'],
  ])('rejects %s', (_label, name) => {
    expect(() => readTemplateZip(zip({ 'index.md': INDEX, [name]: '# x' }))).toThrow(PackageError)
  })

  it('rejects an entry that is both a file and a folder', () => {
    expect(() => readTemplateZip(zip({ 'index.md': INDEX, 'chapters/a.md': '# a', 'chapters': '# x' }))).toThrow(PackageError)
  })
})

describe('template.json manifest', () => {
  const manifest = (extra: Record<string, unknown> = {}) =>
    JSON.stringify({ id: 'base', name: 'Base Campaign', version: '1.0.0', grimoireVersion: '>=0.1.0', author: 'JF', rootDirectory: 'Draft', structure: [{ path: 'Draft/', type: 'directory' }], ...extra })
  const withManifest = (json: string, files: Record<string, string> = { 'Draft/One.md': '# One' }) => zip({ 'template.json': json, ...files })

  it('accepts a root manifest, does not copy it, and synthesizes an index.md carrying the name', () => {
    const { files, manifest: read } = readTemplatePackage(withManifest(manifest()))
    expect(read).toMatchObject({ id: 'base', name: 'Base Campaign', version: '1.0.0', grimoireVersion: '>=0.1.0', author: 'JF' })
    expect(Object.keys(files).sort()).toEqual(['Draft/One.md', 'index.md'])
    expect(new TextDecoder().decode(files['index.md'])).toBe('---\ntemplateName: Base Campaign\n---\n# Base Campaign\n')
    expect(readTemplateZip(withManifest(manifest()))['template.json']).toBeUndefined()
  })

  it('adds templateName to an existing index.md without touching the rest, and keeps one that is there', () => {
    const plain = readTemplatePackage(withManifest(manifest(), { 'index.md': '---\ntitle: Mine\nitems:\n  - a\n---\n# Body\n' })).files['index.md']
    expect(new TextDecoder().decode(plain)).toBe('---\ntemplateName: Base Campaign\ntitle: Mine\nitems:\n  - a\n---\n# Body\n')
    const own = '---\ntemplateName: Own Label\n---\n# Body\n'
    expect(new TextDecoder().decode(readTemplatePackage(withManifest(manifest(), { 'index.md': own })).files['index.md'])).toBe(own)
    expect(new TextDecoder().decode(readTemplatePackage(withManifest(manifest(), { 'index.md': '# Just text\n' })).files['index.md'])).toBe('---\ntemplateName: Base Campaign\n---\n# Just text\n')
  })

  it('quotes a name that could break the frontmatter', () => {
    const { files } = readTemplatePackage(withManifest(manifest({ name: 'Evil: name # x' })))
    const index = new TextDecoder().decode(files['index.md'])
    expect(index.split('\n')[1]).toBe("templateName: 'Evil: name # x'")
  })

  it('allows exactly one wrapper folder, manifest included', () => {
    const wrapped = zip({ 'my-folder/template.json': manifest(), 'my-folder/Draft/One.md': '# One' })
    expect(Object.keys(readTemplateZip(wrapped)).sort()).toEqual(['Draft/One.md', 'index.md'])
  })

  it('ignores a structure that does not match the files', () => {
    expect(() => readTemplateZip(withManifest(manifest({ structure: [{ path: 'Nope/x.md', type: 'file' }] })))).not.toThrow()
  })

  it.each([
    ['an unknown field', manifest({ minAppVersion: '1.0.0' }), /unknown field/],
    ['a __proto__ key', '{"id":"a","name":"b","version":"1.0.0","__proto__":{}}', /unknown field/],
    ['a missing name', manifest({ name: undefined }), /needs a "name"/],
    ['an empty name', manifest({ name: '   ' }), /needs a "name"/],
    ['a missing id', manifest({ id: undefined }), /needs a "id"/],
    ['an id with a path in it', manifest({ id: '../x' }), /"id" may only use/],
    ['a name that is not text', manifest({ name: 5 }), /must be text/],
    ['a name over 120 characters', manifest({ name: 'x'.repeat(121) }), /longer than 120/],
    ['a bidi control in the name', manifest({ name: 'abc\u202edef' }), /invisible/],
    ['a control character in the author', manifest({ author: 'a\u0007b' }), /control/],
    ['a bad version', manifest({ version: 'v1' }), /1\.0\.0/],
    ['a bad grimoireVersion', manifest({ grimoireVersion: '^1.0.0' }), />=1\.0\.0/],
    ['a structure that is not a list', manifest({ structure: 'x' }), /structure/],
    ['a structure entry of the wrong shape', manifest({ structure: [{ path: 'a', type: 'symlink' }] }), /structure/],
    ['a structure entry with extra fields', manifest({ structure: [{ path: 'a', type: 'file', mode: 7 }] }), /structure/],
    ['JSON that is an array', '[]', /must be an object/],
    ['invalid JSON', '{nope', /not valid JSON/],
  ])('refuses %s', (_label, json, message) => {
    expect(() => readTemplateZip(withManifest(json))).toThrow(message)
    expect(() => readTemplateZip(withManifest(json))).toThrow(PackageError)
  })

  it('refuses a template that needs a newer app, saying which version', () => {
    expect(() => readTemplateZip(withManifest(manifest({ grimoireVersion: '>=999.0.0' })))).toThrow(/needs Grimoire Maker 999\.0\.0 or newer/)
    expect(() => parseTemplateManifest(strToU8(manifest({ grimoireVersion: '>=1.2.0' })), '1.1.9')).toThrow(/1\.2\.0/)
    expect(() => parseTemplateManifest(strToU8(manifest({ grimoireVersion: '>=1.2.0' })), '1.2.0')).not.toThrow()
    expect(() => parseTemplateManifest(strToU8(manifest({ grimoireVersion: '>=1.2.0' })), '2.0.0')).not.toThrow()
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('refuses an oversized manifest', () => {
    expect(() => parseTemplateManifest(new Uint8Array(300 * 1024))).toThrow(/too large/)
  })

  it('refuses template.json anywhere but the top level, and other JSON as before', () => {
    expect(() => readTemplateZip(zip({ 'index.md': INDEX, 'Draft/template.json': manifest() }))).toThrow(/top level/)
    expect(() => readTemplateZip(zip({ 'template.json': manifest(), 'wrapper/template.json': manifest(), 'wrapper/a.md': 'x' }))).toThrow(/top level/)
    expect(() => readTemplateZip(zip({ 'index.md': INDEX, 'a/b/template.json': manifest() }))).toThrow(/not allowed/)
    expect(() => readTemplateZip(zip({ 'index.md': INDEX, 'package.json': '{}' }))).toThrow(/not allowed/)
  })

  it('without a manifest, an archive still needs its own index.md', () => {
    expect(() => readTemplateZip(zip({ 'Draft/One.md': '# One' }))).toThrow(/index\.md/)
  })

  it('does not let a manifest bypass the path rules or the remote-resource check', () => {
    expect(() => readTemplateZip(withManifest(manifest(), { '../evil.md': 'x' }))).toThrow(/Unsafe path/)
    expect(() => readTemplateZip(withManifest(manifest(), { 'theme.css': '@import url(https://x.test/a.css);' }))).toThrow(/remote/)
  })
})

describe('text helpers', () => {
  it('cleanLine removes control and invisible characters and bounds the length', () => {
    expect(cleanLine('  a\u200bb\u202ec\nd\te  ', 50)).toBe('abc d e')
    expect(cleanLine('x'.repeat(30), 10)).toBe('x'.repeat(10))
  })

  it.each([
    ['Encounter Table (d6)', 'Encounter-Table-d6'],
    ['../../etc/passwd', 'etc-passwd'],
    ['CON', 'CON-1'],
    ['  ', 'fallback'],
    ['Café Ünïcode', 'Café-Ünïcode'],
  ])('sanitizePathSegment(%j) -> %j', (input, expected) => {
    expect(sanitizePathSegment(input, 'fallback')).toBe(expected)
  })

  it('sanitizePathSegment can keep spaces for group names', () => {
    expect(sanitizePathSegment('Dungeons & Dragons (5e)', 'General', { spaces: true })).toBe('Dungeons Dragons (5e)')
  })

  it('slugify produces ids the importer accepts', () => {
    expect(slugify('Estructura Base de Campaña!', 'template')).toBe('estructura-base-de-campana')
    expect(slugify('***', 'template')).toBe('template')
    expect(slugify('nul', 'template')).toBe('template-nul')
  })

  it.each([
    ['Plain name', 'Plain name'],
    ['Needs: quoting', "'Needs: quoting'"],
    ['It\'s "mixed"', '"It\'s \\"mixed\\""'],
    ['2024', "'2024'"],
    ['true', "'true'"],
    ['a\nb', 'a b'],
    ['---', "'---'"],
  ])('yamlScalar(%j) -> %s', (input, expected) => {
    expect(yamlScalar(input)).toBe(expected)
  })

  it('isSafePackagePath mirrors the importer rules', () => {
    expect(isSafePackagePath('Draft/One.md')).toBe(true)
    for (const bad of ['../x.md', '/x.md', 'a\\b.md', 'C:/x.md', 'CON.md', 'a/b:c.md', 'a<b.md', 'x\u200b.md', 'a//b.md', 'trail.']) expect(isSafePackagePath(bad)).toBe(false)
  })
})

describe('packageIdFromFileName: archive extensions', () => {
  it('drops .zip and .gmtemplate', () => {
    expect(packageIdFromFileName('My Pack.gmtemplate', new Set())).toBe('My-Pack')
    expect(packageIdFromFileName('My Pack.zip', new Set())).toBe('My-Pack')
  })
})

describe('packageIdFromFileName: Windows device names', () => {
  it.each(['CON.zip', 'nul.zip', 'COM1.zip', 'aux.zip'])('does not use %s as a folder name', (name) => {
    expect(packageIdFromFileName(name, new Set())).toMatch(/^template-/)
  })
})
