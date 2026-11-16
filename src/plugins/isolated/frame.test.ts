// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { frameCsp, frameScriptHash } from './frame'
import { WORKER_BOOTSTRAP } from './workerBootstrap'

describe('isolated frame policy', () => {
  const policy = frameCsp('HASH')
  it('denies by default and closes network, forms and base changes', () => {
    expect(policy).toContain("default-src 'none'")
    expect(policy).toContain("connect-src 'none'")
    expect(policy).toContain("form-action 'none'")
    expect(policy).toContain("base-uri 'none'")
  })
  it('allows only the hashed frame script and blob Workers to execute', () => {
    expect(policy).toContain("script-src 'sha256-HASH' blob:")
    expect(policy).toContain('worker-src blob:')
    expect(policy).not.toMatch(/unsafe-inline|unsafe-eval|https?:|\*/)
  })
})

describe('worker bootstrap', () => {
  it('is syntactically valid script', () => {
    expect(() => new Function(WORKER_BOOTSTRAP)).not.toThrow()
  })
  it('exposes no host-reaching names', () => {
    expect(WORKER_BOOTSTRAP).not.toMatch(/__TAURI|invoke\(|importScripts|fetch\(/)
  })
})

describe('app content security policy', () => {
  const security = () => import('../../../src-tauri/tauri.conf.json').then((config) => config.app.security as Record<string, unknown>)
  const directives = (csp: string) => new Map(csp.split(';').map((part) => part.trim().split(/\s+/)).map(([name, ...values]) => [name, values]))

  it('lets the plugin frame run its one inline script, which inherits the app policy', async () => {
    const csp = directives(String((await security()).csp))
    expect(csp.get('script-src')).toContain(`'sha256-${await frameScriptHash()}'`)
    expect(csp.get('worker-src')).toContain('blob:')
  })

  it('blocks scripts from anywhere but the app bundle and keeps injected styles working', async () => {
    const config = await security()
    const csp = directives(String(config.csp))
    expect(csp.get('default-src')).toEqual(["'self'"])
    expect(csp.get('script-src')!.filter((value) => !value.startsWith("'sha256-"))).toEqual(["'self'"])
    expect(csp.get('object-src')).toEqual(["'none'"])
    expect(csp.get('connect-src')).toEqual(expect.arrayContaining(['ipc:', 'http://ipc.localhost']))
    expect(csp.get('style-src')).toContain("'unsafe-inline'")
    // Tauri adds nonces to style-src otherwise, and a nonce makes the browser ignore 'unsafe-inline'.
    expect(config.dangerousDisableAssetCspModification).toEqual(['style-src'])
  })
})
