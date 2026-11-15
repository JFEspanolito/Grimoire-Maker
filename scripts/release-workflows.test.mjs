// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createManifest, findSignedBundles } from './generate-update-manifest.mjs'

const workflowsDir = new URL('../.github/workflows/', import.meta.url)
const release = readFileSync(new URL('release.yml', workflowsDir), 'utf8')
const workflows = readdirSync(workflowsDir).filter(name => /\.ya?ml$/.test(name))
  .map(name => ({ name, source: readFileSync(new URL(name, workflowsDir), 'utf8') }))
function job(name) {
  return release.split(`\n  ${name}:`)[1]?.split(/\n  [\w-]+:/)[0] ?? ''
}

describe('release workflow coordination', () => {
  it('builds both operating systems in one matrix before a single publisher', () => {
    expect(job('build')).toContain('matrix:')
    expect(job('build')).toContain('windows-latest')
    expect(job('build')).toContain('macos-latest')
    expect(job('publish')).toMatch(/needs:\s*\[?build\]?/)
    expect(workflows.flatMap(({ name, source }) => [...source.matchAll(/uses:\s*softprops\/action-gh-release@/g)].map(() => name)))
      .toEqual(['release.yml'])
  })
  it('generates a fresh combined manifest only after downloading both build artifacts', () => {
    const publisher = job('publish')
    expect(job('build')).not.toContain('generate-update-manifest')
    expect(publisher).toContain('actions/download-artifact@')
    expect(publisher).toContain('merge-multiple: true')
    expect(publisher.indexOf('actions/download-artifact@')).toBeLessThan(publisher.indexOf('generate-update-manifest.mjs'))
    expect(publisher).toContain('--bundle-dir release/bundles')
    expect(publisher).not.toContain('--existing')
    expect(release).not.toContain('existing-latest.json')
  })
  it('keeps an empty manual tag artifact-only and publishes no manifests from build jobs', () => {
    expect(release).toContain('tag_name:')
    expect(job('publish')).toMatch(/if:.*startsWith\(github\.ref, 'refs\/tags\/v'\).*inputs\.tag_name != ''/)
    expect(job('build')).not.toContain('release/latest.json')
    expect(job('publish')).toContain('release/latest.json')
  })
  it('builds a universal macOS app and labels its archive and unchanged signature together', () => {
    const build = job('build')
    expect(build).toContain('rustup target add aarch64-apple-darwin x86_64-apple-darwin')
    expect(build).toContain('--target universal-apple-darwin')
    expect(build).toContain('src-tauri/target/universal-apple-darwin/release/bundle/dmg/*.dmg')
    expect(build).toContain('src-tauri/target/universal-apple-darwin/release/bundle/macos/*.app.tar.gz*')
    expect(build).toContain('universal="${archive%.app.tar.gz}_universal.app.tar.gz"')
    expect(build).toContain('mv "$archive" "$universal"')
    expect(build).toContain('mv "$archive.sig" "$universal.sig"')
  })
  it('combines the signed updater bundles from both platforms without existing release state', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'grimoire-release-manifest-'))
    console.info(`release manifest scratch retained: ${scratch}`)
    for (const [name, signature] of [['Book_x64-setup.exe', 'windows-signature'], ['Book_universal.app.tar.gz', 'mac-signature']]) {
      writeFileSync(join(scratch, name), 'bundle')
      writeFileSync(join(scratch, `${name}.sig`), signature)
    }
    const manifest = createManifest({ tag: 'v0.1.17', bundles: findSignedBundles(scratch) })
    expect(manifest.platforms['windows-x86_64'].signature).toBe('windows-signature')
    expect(manifest.platforms['darwin-aarch64'].signature).toBe('mac-signature')
    expect(manifest.platforms['darwin-x86_64'].signature).toBe('mac-signature')
  })
})
