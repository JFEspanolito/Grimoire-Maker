import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { installErrorLogging, reportError } from './errorLogging'
import { useSessionStore } from '../stores/sessionStore'
import { useThemeStore } from '../stores/themeStore'
import { useTemplateStore } from '../stores/templateStore'
import { useModStore } from '../stores/modStore'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: vi.fn() }))
let uninstall: (() => void) | undefined
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(isTauri).mockReturnValue(true)
  vi.mocked(invoke).mockResolvedValue(undefined)
  useSessionStore.setState({ workspaceError: null })
  useThemeStore.setState({ errors: [] })
  useTemplateStore.setState({ errors: [] })
  useModStore.setState({ errors: [] })
})
afterEach(() => { uninstall?.(); uninstall = undefined; vi.restoreAllMocks() })

it('installs once, preserves console behavior and deduplicates propagated errors across sources', async () => {
  const original = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  uninstall = installErrorLogging()
  expect(installErrorLogging()).toBe(uninstall)
  const error = new Error('copy failed')
  console.error(error)
  window.dispatchEvent(new ErrorEvent('error', { error, message: error.message }))
  reportError('workspace', error.message)
  await Promise.resolve()
  expect(original).toHaveBeenCalledWith(error)
  expect(invoke).toHaveBeenCalledTimes(1)
  expect(invoke).toHaveBeenCalledWith('append_error_log', expect.objectContaining({ source: 'console.error', message: expect.stringContaining('copy failed') }))
})
it('captures uncaught rejections and store errors without duplicating mirrored mod/template errors', async () => {
  uninstall = installErrorLogging()
  const event = new Event('unhandledrejection')
  Object.defineProperty(event, 'reason', { value: new Error('rejected save') })
  window.dispatchEvent(event)
  useSessionStore.setState({ workspaceError: 'workspace inaccessible' })
  useThemeStore.setState({ errors: ['theme unreadable'] })
  useTemplateStore.setState({ errors: ['invalid template'] })
  useModStore.setState({ errors: ['invalid template'] })
  await Promise.resolve()
  expect(invoke).toHaveBeenCalledTimes(4)
})
it('does not serialize objects or credentials and bounds error text', async () => {
  uninstall = installErrorLogging()
  reportError('test', { document: 'private manuscript', password: 'private password' })
  reportError('test', 'token=secret-value password=hunter2 Bearer abc.def.ghi')
  reportError('test', new Error('x'.repeat(30_000)))
  await Promise.resolve()
  const args = vi.mocked(invoke).mock.calls.map(call => call[1] as { message: string })
  expect(args[0].message).not.toContain('private')
  expect(args[1].message).not.toMatch(/secret-value|hunter2|abc\.def\.ghi/)
  expect(args[2].message.length).toBeLessThanOrEqual(16_384)
})
it('does not recurse or leak rejected logger invocations, and later errors remain loggable', async () => {
  uninstall = installErrorLogging()
  vi.mocked(invoke).mockRejectedValueOnce(new Error('logger disk full'))
  reportError('test', 'first failure')
  await Promise.resolve(); await Promise.resolve()
  reportError('test', 'second failure')
  await Promise.resolve()
  expect(invoke).toHaveBeenCalledTimes(2)
})
it('does not invoke native logging in browser development', async () => {
  vi.mocked(isTauri).mockReturnValue(false)
  uninstall = installErrorLogging()
  reportError('test', new Error('browser only'))
  expect(invoke).not.toHaveBeenCalled()
})
it('allows a repeated error after the deduplication window and detaches handlers on cleanup', () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(10_000)
  uninstall = installErrorLogging()
  reportError('first', 'temporary error')
  reportError('second', 'temporary error')
  clock.mockReturnValue(15_001)
  reportError('third', 'temporary error')
  expect(invoke).toHaveBeenCalledTimes(2)
  uninstall()
  window.dispatchEvent(new ErrorEvent('error', { message: 'after cleanup' }))
  expect(invoke).toHaveBeenCalledTimes(2)
})
it('bounds pending writes during an error storm', async () => {
  uninstall = installErrorLogging()
  const completions: Array<() => void> = []
  vi.mocked(invoke).mockImplementation(() => new Promise<void>(resolve => completions.push(resolve)))
  for (let index = 0; index < 100; index++) reportError('storm', `failure ${index}`)
  expect(invoke).toHaveBeenCalledTimes(64)
  completions.forEach(complete => complete())
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
})
