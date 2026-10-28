import { describe, expect, it } from 'vitest'
import { frameCsp } from './frame'
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
