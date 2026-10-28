// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unzipSync } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'
// @ts-expect-error the tool is a plain ES module without type declarations
import { buildPortableZip, makePortable, readmeText, zipName } from './make-portable.mjs'

const folders: string[] = []
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }) })
const scratch = () => { const folder = mkdtempSync(join(tmpdir(), 'make-portable-')); folders.push(folder); return folder }

describe('make-portable', () => {
  it('names the zip after the version and rejects odd versions', () => {
    expect(zipName('0.1.0')).toBe('GrimoireMaker-portable-0.1.0-x64.zip')
    expect(zipName('1.2.3-beta.1')).toBe('GrimoireMaker-portable-1.2.3-beta.1-x64.zip')
    expect(() => zipName('../1.0')).toThrow(/not a valid version/)
  })

  it('holds the renamed exe, an empty flag and the readme, in sorted order', () => {
    const exe = new Uint8Array([1, 2, 3, 4])
    const files = unzipSync(buildPortableZip(exe, '0.1.0'))
    expect(Object.keys(files)).toEqual(['Grimoire Maker.exe', 'README-portable.txt', 'portable.flag'])
    expect([...files['Grimoire Maker.exe']]).toEqual([1, 2, 3, 4])
    expect(files['portable.flag'].length).toBe(0)
    expect(new TextDecoder().decode(files['README-portable.txt'])).toBe(readmeText('0.1.0'))
  })

  it('documents the portable behaviour in the readme', () => {
    const text = readmeText('0.1.0')
    for (const needle of ['Data\\', 'WebView2', 'https://developer.microsoft.com/microsoft-edge/webview2/', 'portable.flag', 'writable', 'message box', 'does not fall back to %APPDATA%', 'There is no automatic update']) {
      expect(text.toLowerCase()).toContain(needle.toLowerCase())
    }
  })

  it('is deterministic', () => {
    const exe = new Uint8Array([9, 8, 7])
    expect(buildPortableZip(exe, '0.1.0')).toEqual(buildPortableZip(exe, '0.1.0'))
  })

  it('writes the zip next to the requested folder and fails plainly without the exe', () => {
    const folder = scratch()
    const exe = join(folder, 'grimoire-maker.exe')
    expect(() => makePortable({ exe, out: join(folder, 'release'), version: '0.1.0' })).toThrow(/was not found.*tauri build --no-bundle/)
    writeFileSync(exe, 'MZ-fake')
    const { path, size } = makePortable({ exe, out: join(folder, 'release'), version: '0.1.0' })
    expect(path).toBe(join(folder, 'release', 'GrimoireMaker-portable-0.1.0-x64.zip'))
    expect(readFileSync(path).length).toBe(size)
    expect(Object.keys(unzipSync(readFileSync(path)))).toHaveLength(3)
  })
})
