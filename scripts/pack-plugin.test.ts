// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unzipSync } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'
// @ts-expect-error the tool is a plain ES module without type declarations
import { packPlugin } from './pack-plugin.mjs'

const folders: string[] = []
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }) })

const manifest = { schemaVersion: 1, sdkVersion: 1, id: 'community.demo', name: 'Demo', version: '1.0.0', author: 'A', description: 'D', main: 'dist/index.js' }

function project(files: Record<string, string>, overrides: Record<string, unknown> = {}) {
  const folder = mkdtempSync(join(tmpdir(), 'pack-plugin-'))
  folders.push(folder)
  writeFileSync(join(folder, 'manifest.json'), JSON.stringify({ ...manifest, ...overrides }))
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(folder, name, '..'), { recursive: true })
    writeFileSync(join(folder, name), text)
  }
  return folder
}

describe('pack-plugin', () => {
  it('packs manifest.json and dist/** into a deterministic archive named after id and version', () => {
    const folder = project({ 'dist/index.js': 'grimoire.zoom.get()', 'dist/extra/a.txt': 'x', 'notes.md': 'not packaged' })
    const first = packPlugin(folder)
    expect(first.name).toBe('community.demo-1.0.0.gmp')
    expect(Object.keys(unzipSync(first.bytes)).sort()).toEqual(['dist/extra/a.txt', 'dist/index.js', 'manifest.json'])
    expect(Buffer.from(packPlugin(folder).bytes).equals(Buffer.from(first.bytes))).toBe(true)
  })

  it.each([
    ['a missing entry file', () => project({ 'dist/other.js': 'x' }), /index\.js is missing/],
    ['no dist folder', () => project({}), /no dist\/ folder/],
    ['a wrong main', () => project({ 'dist/index.js': 'x' }, { main: 'dist/other.js' }), /"main" must be exactly/],
    ['a builtin id', () => project({ 'dist/index.js': 'x' }, { id: 'builtin.zoom' }), /reserved/],
    ['a missing field', () => project({ 'dist/index.js': 'x' }, { author: undefined }), /no "author"/],
  ])('refuses %s', (_label, make, message) => {
    expect(() => packPlugin(make())).toThrow(message)
  })

  // Windows and macOS folders cannot hold two names that differ only by case.
  it.skipIf(process.platform === 'win32' || process.platform === 'darwin')('refuses names that differ only by case', () => {
    expect(() => packPlugin(project({ 'dist/index.js': 'x', 'dist/A.js': '1', 'dist/a.js': '2' }))).toThrow(/collides/)
  })

  it('refuses oversized files', () => {
    expect(() => packPlugin(project({ 'dist/index.js': 'x'.repeat(8 * 1024 * 1024 + 1) }))).toThrow(/larger than 8 MiB/)
  })

  it('refuses links', () => {
    const linked = project({ 'dist/index.js': 'x' })
    try { symlinkSync(join(linked, 'manifest.json'), join(linked, 'dist/link.js')) } catch { return } // links need privileges on Windows
    expect(() => packPlugin(linked)).toThrow(/link/)
  })
})
