import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { ModManager } from './ModManager'
import { useModStore } from '../../stores/modStore'
import { invoke } from '@tauri-apps/api/core'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => {}) }))
vi.mock('../../hooks/useFileSystem', () => ({ isTauri: () => true }))
const initial = useModStore.getState()
beforeAll(() => {
  // jsdom has no native dialog implementation; native focus trapping needs desktop verification.
  HTMLDialogElement.prototype.showModal = function () { this.open = true }
  HTMLDialogElement.prototype.close = function () { this.open = false }
})
afterEach(() => { useModStore.setState(initial); vi.clearAllMocks() })

it('shows folder mods, changes activation and opens only the native Mods action', async () => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  const toggle = vi.fn(async () => {})
  const reload = vi.fn(async () => {})
  const close = vi.fn()
  useModStore.setState({ root: '/config/Mods', busy: false, ready: true, errors: [], reload, setEnabled: toggle,
    mods: [{ id: 'Snippets/dnd', kind: 'Snippets', folder: '/config/Mods/Snippets/dnd', label: 'D&D', enabled: true, errors: [] }] })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(<ModManager onClose={close} />))
  expect(reload).toHaveBeenCalledOnce()
  expect(container.querySelector('dialog')?.open).toBe(true)
  expect(container.querySelector<HTMLInputElement>('[aria-label="Default mods folder path"]')?.value).toBe('/config/Mods')
  await act(async () => container.querySelector<HTMLInputElement>('[aria-label="Enable D&D"]')?.click())
  expect(toggle).toHaveBeenCalledWith('Snippets/dnd', false)
  await act(async () => Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Open Default Mods Folder')?.click())
  expect(invoke).toHaveBeenCalledWith('open_mods_folder')
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Close Mod Manager"]')?.click())
  expect(close).toHaveBeenCalledOnce()
  await act(async () => root.unmount())
  container.remove()
})
