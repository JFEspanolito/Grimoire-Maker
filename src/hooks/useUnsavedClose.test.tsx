import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useUnsavedClose } from './useUnsavedClose'
import { useDocumentStore } from '../stores/documentStore'
import capability from '../../src-tauri/capabilities/default.json'

const native = vi.hoisted(() => ({ close: vi.fn(async () => {}), onCloseRequested: vi.fn() }))
const saveAll = vi.hoisted(() => vi.fn(async () => true))
const dialog = vi.hoisted(() => ({ message: vi.fn(async () => 'Save') }))
vi.mock('@tauri-apps/plugin-dialog', () => dialog)
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => native }))
vi.mock('./useFileSystem', () => ({ isTauri: () => true, useFileSystem: () => ({ saveAll }) }))
function Harness() { useUnsavedClose(); return null }
let activeRoot: ReturnType<typeof createRoot> | null = null
beforeEach(() => { dialog.message.mockResolvedValue('Save') })
afterEach(async () => { if (activeRoot) await act(async () => activeRoot?.unmount()); activeRoot = null })

it.each(['Discard', 'Cancel'])('offers %s for an untitled dirty document without trying Save As', async (choice) => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  let listener: (event: { preventDefault: () => void }) => void = () => {}
  native.onCloseRequested.mockImplementation(async (callback) => { listener = callback; return vi.fn() })
  activeRoot = createRoot(document.createElement('div'))
  await act(async () => activeRoot?.render(<Harness />))
  useDocumentStore.getState().loadFromRaw(null, 'Notes')
  useDocumentStore.getState().setWorkspace(null, [])
  useDocumentStore.getState().setBody('Unsaved notes')
  dialog.message.mockResolvedValueOnce(choice)
  const event = { preventDefault: vi.fn() }
  await act(async () => listener(event))
  expect(event.preventDefault).toHaveBeenCalled()
  expect(dialog.message).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
    buttons: { yes: 'Save', no: 'Discard', cancel: 'Cancel' },
  }))
  expect(saveAll).not.toHaveBeenCalled()
  if (choice === 'Discard') {
    expect(native.close).toHaveBeenCalledTimes(1)
    // The native close callback runs again; the deliberate discard must permit it.
    const confirmed = { preventDefault: vi.fn() }
    listener(confirmed)
    expect(confirmed.preventDefault).not.toHaveBeenCalled()
  } else expect(native.close).not.toHaveBeenCalled()
  expect(useDocumentStore.getState().document.body).toBe('Unsaved notes')
})
afterEach(() => { useDocumentStore.getState().resetDocuments(); vi.clearAllMocks() })

it('authorizes the SDK destroy operation after main-window close protection allows closing', () => {
  expect(capability.windows).toEqual(['main'])
  expect(capability.permissions).toContain('core:window:allow-destroy')
})

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
