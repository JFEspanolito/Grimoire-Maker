import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { useUnsavedClose } from './useUnsavedClose'
import { useDocumentStore } from '../stores/documentStore'

const native = vi.hoisted(() => ({ close: vi.fn(async () => {}), onCloseRequested: vi.fn() }))
const saveAll = vi.hoisted(() => vi.fn(async () => true))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => native }))
vi.mock('./useFileSystem', () => ({ isTauri: () => true, useFileSystem: () => ({ saveAll }) }))
function Harness() { useUnsavedClose(); return null }
afterEach(() => { useDocumentStore.getState().resetDocuments(); vi.clearAllMocks() })

it('prevents native close until every buffer saves and retains window on cancellation', async () => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  let listener: (event: { preventDefault: () => void }) => void = () => {}
  const stop = vi.fn()
  native.onCloseRequested.mockImplementation(async (callback) => { listener = callback; return stop })
  const root = createRoot(document.createElement('div'))
  await act(async () => root.render(<Harness />))
  useDocumentStore.getState().loadFromRaw('/a.md', 'A')
  useDocumentStore.getState().setBody('dirty')
  useDocumentStore.getState().loadFromRaw('/b.md', 'B')
  const event = { preventDefault: vi.fn() }
  saveAll.mockResolvedValueOnce(false)
  await act(async () => listener(event))
  expect(event.preventDefault).toHaveBeenCalled()
  expect(native.close).not.toHaveBeenCalled()
  await act(async () => listener(event))
  expect(native.close).toHaveBeenCalledOnce()
  await act(async () => root.unmount())
  expect(stop).toHaveBeenCalled()
})
