import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAutoSave } from './useAutoSave'
import { useSettingsStore } from '../stores/settingsStore'
const save = vi.hoisted(() => vi.fn())
vi.mock('./useFileSystem', () => ({ isTauri: () => true, useFileSystem: () => ({ autoSave: save }) }))
let root: ReturnType<typeof createRoot>
function Harness({ ready = true }) { useAutoSave(ready); return null }
beforeEach(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  vi.useFakeTimers(); save.mockReset().mockResolvedValue(undefined)
  useSettingsStore.setState({ autoSaveSeconds: 300 })
  root = createRoot(document.createElement('div'))
})
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers() })
it('starts after hydration, runs every five minutes, and applies a new interval immediately', async () => {
  await act(async () => root.render(<Harness ready={false} />))
  await act(async () => vi.advanceTimersByTimeAsync(300000))
  expect(save).not.toHaveBeenCalled()
  await act(async () => root.render(<Harness />))
  await act(async () => vi.advanceTimersByTimeAsync(299999))
  expect(save).not.toHaveBeenCalled()
  await act(async () => vi.advanceTimersByTimeAsync(1))
  expect(save).toHaveBeenCalledOnce()
  await act(async () => useSettingsStore.getState().setAutoSaveSeconds(90))
  await act(async () => vi.advanceTimersByTimeAsync(90000))
  expect(save).toHaveBeenCalledTimes(2)
  await act(async () => root.unmount())
  await act(async () => vi.advanceTimersByTimeAsync(300000))
  expect(save).toHaveBeenCalledTimes(2)
})
it('never overlaps slow writes, including interval changes, and retries after failures', async () => {
  let finish!: () => void
  save.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  await act(async () => root.render(<Harness />))
  await act(async () => vi.advanceTimersByTimeAsync(300000))
  await act(async () => useSettingsStore.getState().setAutoSaveSeconds(1))
  await act(async () => vi.advanceTimersByTimeAsync(10000))
  expect(save).toHaveBeenCalledOnce()
  await act(async () => finish())
  save.mockRejectedValueOnce(new Error('Reported save failure'))
  await act(async () => vi.advanceTimersByTimeAsync(2000))
  expect(save).toHaveBeenCalledTimes(3)
})
