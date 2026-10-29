import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { DocumentOrderDialog } from './DocumentOrderDialog'
import { useDocumentStore } from '../../stores/documentStore'
import { useProjectStore } from '../../stores/projectStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { EMPTY_PROJECT } from '../../lib/projectSettings'

const saveProjectSettings = vi.hoisted(() => vi.fn())
vi.mock('../../lib/projectSettings', async (original) => ({ ...(await original<typeof import('../../lib/projectSettings')>()), saveProjectSettings }))

const file = (path: string) => ({ name: path.split('/').pop()!, path, isDirectory: false })
afterEach(() => { useDocumentStore.getState().setWorkspace(null, []); useProjectStore.setState({ entries: {} }); useSettingsStore.setState({ language: 'en' }) })

it('lists Draft documents in explorer order, lets the author reorder and exclude them, and saves the choice', async () => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: vi.fn() })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: vi.fn() })
  saveProjectSettings.mockResolvedValue(undefined)
  useDocumentStore.getState().setWorkspace('/w', [
    { name: 'Draft', path: '/w/Draft', isDirectory: true, children: [file('/w/Draft/A.md'), file('/w/Draft/B.md'), file('/w/Draft/C.md')] },
    { name: 'Trash', path: '/w/Trash', isDirectory: true, children: [file('/w/Trash/Old.md')] },
  ])
  useProjectStore.setState({ entries: { '/w': { settings: EMPTY_PROJECT, ready: true, busy: false, error: '' } } })
  const onClose = vi.fn()
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    await act(async () => root.render(<DocumentOrderDialog root="/w" onClose={onClose} />))
    const names = () => Array.from(container.querySelectorAll('li span'), (item) => item.textContent)
    expect(names()).toEqual(['A', 'B', 'C'])
    expect(Array.from(container.querySelectorAll<HTMLInputElement>('input')).every((box) => box.checked)).toBe(true)
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Move C up"]')!.click())
    expect(names()).toEqual(['A', 'C', 'B'])
    await act(async () => container.querySelector<HTMLInputElement>('[aria-label="Include A"]')!.click())
    expect(container.textContent).toContain('2 of 3 included')
    await act(async () => Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Save')!.click())
    expect(saveProjectSettings).toHaveBeenCalledWith('/w', expect.objectContaining({
      documentOrder: { order: ['Draft/A.md', 'Draft/C.md', 'Draft/B.md'], excluded: ['Draft/A.md'] },
    }))
    expect(onClose).toHaveBeenCalledOnce()
  } finally { await act(async () => root.unmount()) }
})

it('translates DocumentOrderDialog to Spanish', async () => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: vi.fn() })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: vi.fn() })
  useSettingsStore.setState({ language: 'es' })
  useDocumentStore.getState().setWorkspace('/w', [
    { name: 'Draft', path: '/w/Draft', isDirectory: true, children: [file('/w/Draft/A.md'), file('/w/Draft/B.md')] },
  ])
  useProjectStore.setState({ entries: { '/w': { settings: EMPTY_PROJECT, ready: true, busy: false, error: '' } } })
  const onClose = vi.fn()
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    await act(async () => root.render(<DocumentOrderDialog root="/w" onClose={onClose} />))
    expect(container.querySelector('#document-order-title')?.textContent).toBe('Orden de documentos')
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Cerrar orden de documentos"]')).not.toBeNull()
    expect(container.querySelector<HTMLInputElement>('[aria-label="Incluir A"]')).not.toBeNull()
    expect(container.textContent).toContain('2 de 2 incluidos')
  } finally { await act(async () => root.unmount()) }
})
