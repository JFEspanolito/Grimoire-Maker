import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createManifest, detectPlatforms, findSignedBundles } from './generate-update-manifest.mjs'

describe('generate-update-manifest', () => {
  let testDir

  beforeEach(() => {
    testDir = join(tmpdir(), `grimoire-manifest-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('detects platform identifiers correctly from bundle filenames', () => {
    expect(detectPlatforms('Grimoire Maker_0.2.0_x64-setup.nsis.zip')).toEqual(['windows-x86_64'])
    expect(detectPlatforms('Grimoire Maker.app.tar.gz')).toEqual(['darwin-aarch64', 'darwin-x86_64'])
    expect(detectPlatforms('Grimoire Maker_aarch64.app.tar.gz')).toEqual(['darwin-aarch64'])
    expect(detectPlatforms('Grimoire Maker_x64.app.tar.gz')).toEqual(['darwin-x86_64'])
  })

  it('finds signed bundles and matches signatures', () => {
    const bundleFile = join(testDir, 'app-setup.nsis.zip')
    const sigFile = join(testDir, 'app-setup.nsis.zip.sig')
    writeFileSync(bundleFile, 'dummy zip content')
    writeFileSync(sigFile, 'test-signature-minisign-base64')

    const found = findSignedBundles(testDir)
    expect(found).toHaveLength(1)
    expect(found[0].bundleFileName).toBe('app-setup.nsis.zip')
    expect(found[0].sigFileName).toBe('app-setup.nsis.zip.sig')
  })

  it('creates valid manifest and merges with existing platforms', () => {
    const bundleFile = join(testDir, 'app-setup.nsis.zip')
    const sigFile = join(testDir, 'app-setup.nsis.zip.sig')
    writeFileSync(bundleFile, 'dummy zip content')
    writeFileSync(sigFile, 'sig-win')

    const bundles = [{
      sigPath: sigFile,
      bundlePath: bundleFile,
      sigFileName: 'app-setup.nsis.zip.sig',
      bundleFileName: 'app-setup.nsis.zip',
    }]

    const existingManifest = {
      version: '0.2.0',
      notes: 'Existing notes',
      pub_date: '2026-11-06T00:00:00.000Z',
      platforms: {
        'darwin-aarch64': {
          signature: 'sig-mac',
          url: 'https://github.com/JFEspanolito/Grimoire-Maker/releases/download/v0.2.0/app.app.tar.gz',
        },
      },
    }

    const manifest = createManifest({
      version: '0.2.0',
      tag: 'v0.2.0',
      bundles,
      existingManifest,
    })

    expect(manifest.version).toBe('0.2.0')
    expect(manifest.platforms['windows-x86_64']).toEqual({
      signature: 'sig-win',
      url: 'https://github.com/JFEspanolito/Grimoire-Maker/releases/download/v0.2.0/app-setup.nsis.zip',
    })
    // Preserves existing macOS platform!
    expect(manifest.platforms['darwin-aarch64']).toBeDefined()
    expect(manifest.platforms['darwin-aarch64'].signature).toBe('sig-mac')
  })
})
