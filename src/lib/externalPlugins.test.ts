import { beforeEach, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { grantPluginConsent, summarizeExternalPlugins, type ExternalPluginVersion } from './externalPlugins'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
beforeEach(() => vi.resetAllMocks())
const version = (dir: string): ExternalPluginVersion => ({ dir, name: 'Local notes', version: dir, fingerprint: `hash-${dir}`, author: 'Author', description: 'Notes', permissions: ['document.read'], granted: [], sdkVersion: 1, consentAt: null, installedAt: 10, source: 'local', localFolder: 'notes', signature: null })

it('shows latest installed bytes while withholding approval belonging to an older version', () => {
  const versions = [version('v1'), version('v2')]
  const rows = summarizeExternalPlugins({ version: 1, disabledAll: false, plugins: {
    notes: { latest: 'v2', current: 'v1', state: 'stopped', versions },
    missing: { latest: 'absent', current: null, state: 'stopped', versions: [] },
  } })
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ id: 'notes', version: 'v2', fingerprint: 'hash-v2', approved: false, localFolder: 'notes' })
  expect(summarizeExternalPlugins({ version: 1, disabledAll: false, plugins: { notes: { latest: 'v2', current: 'v2', state: 'active', versions } } })[0].approved).toBe(true)
})

it('binds consent to the exact version, fingerprint, SDK and requested permissions and propagates rejection', async () => {
  const failure = new Error('Fingerprint changed')
  vi.mocked(invoke).mockRejectedValue(failure)
  const plugin = { id: 'notes', version: 'v2', fingerprint: 'hash-v2', permissions: ['document.read'], sdkVersion: 1 }
  await expect(grantPluginConsent(plugin)).rejects.toBe(failure)
  expect(invoke).toHaveBeenCalledExactlyOnceWith('grant_plugin_consent', { id: 'notes', version: 'v2', fingerprint: 'hash-v2', granted: ['document.read'], sdkVersion: 1 })
})
