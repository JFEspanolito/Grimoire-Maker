import { afterEach, expect, it, vi } from 'vitest'
import { checkForAppUpdates, isNewerVersion } from './versionCheck'
import { getVersion } from '@tauri-apps/api/app'

vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn(async () => '1.0.0') }))
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }))
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

it.each([
  ['v1.2.0', '1.1.0', true], ['1.10.0', '1.9.0', true], ['1.0.0', '1.0.0', false],
  ['1.0.0', '2.0.0', false], ['1.0.0', '1.0.0-beta.1', true],
  ['1.0.0-beta.10', '1.0.0-beta.2', true], ['1.0.0+build.2', '1.0.0+build.1', false],
  ['garbage', '1.0.0', false], ['1.2', '1.0.0', false], ['01.2.0', '1.0.0', false],
])('compares %s with %s', (latest, current, expected) => {
  expect(isNewerVersion(latest, current)).toBe(expected)
})

const release = { tag_name: 'v1.2.0', html_url: 'https://github.com/JFEspanolito/Grimoire-Maker/releases/tag/v1.2.0', draft: false, prerelease: false }
it('checks GitHub against the installed version without credentials', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(release)))
  expect(await checkForAppUpdates()).toEqual({ hasUpdate: true, currentVersion: '1.0.0', latestVersion: 'v1.2.0', releaseUrl: release.html_url })
  expect(fetch).toHaveBeenCalledOnce()
  expect(fetch.mock.calls[0][0]).toBe('https://api.github.com/repos/JFEspanolito/Grimoire-Maker/releases/latest')
  expect(fetch.mock.calls[0][1]?.credentials).toBe('omit')
})
it.each(['network', 'rate limit', 'invalid JSON', 'invalid URL', 'prerelease'])('returns null for %s without throwing', async (failure) => {
  const fetch = vi.spyOn(globalThis, 'fetch')
  if (failure === 'network') fetch.mockRejectedValue(new Error('offline'))
  else if (failure === 'rate limit') fetch.mockResolvedValue(new Response('', { status: 403 }))
  else if (failure === 'invalid JSON') fetch.mockResolvedValue(new Response('{'))
  else fetch.mockResolvedValue(new Response(JSON.stringify({ ...release, ...(failure === 'invalid URL' ? { html_url: 'javascript:alert(1)' } : { prerelease: true }) })))
  expect(await checkForAppUpdates()).toBeNull()
})
it('times out even if a request never settles', async () => {
  vi.useFakeTimers()
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise<Response>(() => {}))
  const check = checkForAppUpdates()
  await vi.advanceTimersByTimeAsync(8000)
  expect(await check).toBeNull()
})
it('contains native version lookup failures without making a network request', async () => {
  vi.mocked(getVersion).mockRejectedValueOnce(new Error('permission denied'))
  const fetch = vi.spyOn(globalThis, 'fetch')
  expect(await checkForAppUpdates()).toBeNull()
  expect(fetch).not.toHaveBeenCalled()
})
it('settles a cancelled check without waiting for the network', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise<Response>(() => {}))
  const controller = new AbortController()
  const check = checkForAppUpdates(controller.signal)
  controller.abort()
  expect(await check).toBeNull()
})
