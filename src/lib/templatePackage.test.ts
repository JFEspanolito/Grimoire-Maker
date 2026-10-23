import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import {
  LIMITS,
  PackageError,
  createTemplateZip,
  packageIdFromFileName,
  readTemplateZip,
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
