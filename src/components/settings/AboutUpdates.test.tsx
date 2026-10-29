import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AboutUpdates } from './AboutUpdates'
import { checkForAppUpdates } from '../../lib/versionCheck'

vi.mock('../../lib/versionCheck', () => ({ checkForAppUpdates: vi.fn() }))
let root: Root
let container: HTMLDivElement
beforeEach(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.resetAllMocks() })
it('checks automatically once in StrictMode, links to the release and dismisses for this session', async () => {
  const info = { hasUpdate: true, currentVersion: '1.0.0', latestVersion: 'v1.2.0', releaseUrl: 'https://github.com/JFEspanolito/Grimoire-Maker/releases/tag/v1.2.0' }
  vi.mocked(checkForAppUpdates).mockResolvedValue(info)
  await act(async () => root.render(<StrictMode><AboutUpdates /></StrictMode>))
  expect(checkForAppUpdates).toHaveBeenCalledOnce()
  expect(container.textContent).toContain('v1.2.0')
  expect(container.querySelector('a')?.href).toBe(info.releaseUrl)
  await act(async () => container.querySelector('button')!.click())
  expect(container.querySelector('a')).toBeNull()
  await act(async () => root.render(null))
  await act(async () => root.render(<AboutUpdates />))
  expect(container.querySelector('a')).toBeNull()
})
it('reports an unavailable check without throwing or blocking other content', async () => {
  vi.mocked(checkForAppUpdates).mockRejectedValue(new Error('offline'))
  await act(async () => root.render(<><AboutUpdates /><button>Close About</button></>))
  expect(container.textContent).toContain('Could not check for updates')
  expect(container.textContent).toContain('Close About')
})
it('shows up-to-date only after a successful check', async () => {
  vi.mocked(checkForAppUpdates).mockResolvedValue({ hasUpdate: false, currentVersion: '1.0.0', latestVersion: 'v1.0.0', releaseUrl: 'https://github.com/JFEspanolito/Grimoire-Maker/releases/tag/v1.0.0' })
  await act(async () => root.render(<AboutUpdates />))
  expect(container.textContent).toContain('up to date')
})
