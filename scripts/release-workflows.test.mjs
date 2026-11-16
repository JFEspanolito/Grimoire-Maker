// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync, rmdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createManifest, findSignedBundles } from './generate-update-manifest.mjs'

const workflowsDir = new URL('../.github/workflows/', import.meta.url)
const release = readFileSync(new URL('release.yml', workflowsDir), 'utf8')
const workflows = readdirSync(workflowsDir).filter(name => /\.ya?ml$/.test(name))
  .map(name => ({ name, source: readFileSync(new URL(name, workflowsDir), 'utf8') }))
function job(name) {
  return release.split(`\n  ${name}:`)[1]?.split(/\n  [\w-]+:/)[0] ?? ''
}

describe('release workflow coordination', () => {
  it('pins every external action to a full commit and keeps release privileges scoped', () => {
    for (const { source } of workflows) {
      for (const [, reference] of source.matchAll(/uses:\s*([^\s#]+)/g)) {
        if (!reference.startsWith('./')) expect(reference).toMatch(/^[\w.-]+\/[\w./-]+@[a-f0-9]{40}$/)
      }
      expect(source).toMatch(/permissions:\s*\n\s+contents: read/)
    }
    expect(job('build')).not.toContain('contents: write')
    expect(job('publish')).toContain('contents: write')
    expect(job('publish')).not.toContain('TAURI_SIGNING_PRIVATE_KEY')
    expect(release).not.toContain('secrets: inherit')
  })
  it('validates release tags as data and rejects shell payloads before publication', () => {
    const publisher = job('publish')
    const script = publisher.match(/node --input-type=module <<'VALIDATE_TAG'\r?\n([\s\S]*?)\r?\n\s+VALIDATE_TAG/)?.[1]
    expect(script).toBeDefined()
    expect(publisher.indexOf("<<'VALIDATE_TAG'")).toBeLessThan(publisher.indexOf('actions/download-artifact@'))
    expect(publisher).toContain('--tag "$TAG"')
    expect(publisher).toContain('tag_name: ${{ env.TAG }}')
    for (const tag of ['v0.1.17', 'v1.2.3-rc.1+build.2', '', 'v1.2.3; echo injected', '$(echo injected)', '`echo injected`', 'v1.2.3\ninjected', 'v1.2.3\n', '--help']) {
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
        env: { ...process.env, TAG: tag }, encoding: 'utf8',
      })
      const valid = ['v0.1.17', 'v1.2.3-rc.1+build.2'].includes(tag)
      expect(result.status, tag).toBe(valid ? 0 : 1)
      expect(result.stdout, tag).toBe('')
      expect(result.stderr, tag).toBe(valid ? '' : 'Release tag must be a version such as v1.2.3 or v1.2.3-rc.1\n')
    }
  })
  it('runs reusable mandatory quality checks before building release artifacts', () => {
    const ci = readFileSync(new URL('ci.yml', workflowsDir), 'utf8')
    expect(ci).toContain('pull_request:')
    expect(ci).toContain('workflow_call:')
    expect(ci).toContain('runs-on: windows-latest')
    for (const command of ['pnpm test', 'pnpm lint', 'pnpm exec tsc -b', 'cargo test --locked', 'cargo clippy --locked --all-targets']) {
      expect(ci).toContain(`run: ${command}`)
    }
    expect(ci).not.toContain('continue-on-error:')
    expect(release).toMatch(/quality:\s*\n\s+uses: \.\/\.github\/workflows\/ci.yml/)
    expect(job('build')).toMatch(/needs:\s*\[?quality\]?/)
    expect(job('publish')).toMatch(/needs:\s*\[?build\]?/)
  })
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
    const ownedFiles = []
    try {
      for (const [name, signature] of [['Book_x64-setup.exe', 'windows-signature'], ['Book_universal.app.tar.gz', 'mac-signature']]) {
        ownedFiles.push(join(scratch, name), join(scratch, `${name}.sig`))
        writeFileSync(join(scratch, name), 'bundle')
        writeFileSync(join(scratch, `${name}.sig`), signature)
      }
      const manifest = createManifest({ tag: 'v0.1.17', bundles: findSignedBundles(scratch) })
      expect(manifest.platforms['windows-x86_64'].signature).toBe('windows-signature')
      expect(manifest.platforms['darwin-aarch64'].signature).toBe('mac-signature')
      expect(manifest.platforms['darwin-x86_64'].signature).toBe('mac-signature')
    } finally {
      for (const file of ownedFiles) rmSync(file, { force: true })
      rmdirSync(scratch)
    }
  })
})
