import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { save } from '@tauri-apps/plugin-dialog'
import { exportPdf } from '../lib/exportPdf'
import { usePrint } from './usePrint'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }))
vi.mock('../lib/exportPdf', () => ({ exportPdf: vi.fn(), PDF_ROUTE: { FILE: 'file', DIALOG: 'dialog' } }))
vi.mock('./useFileSystem', () => ({ isTauri: () => true }))
let print!: () => Promise<void>
let root: Root
let host: HTMLDivElement
function Harness() {
  const action = usePrint()
  useEffect(() => { print = action }, [action])
  return null
}
beforeEach(async () => {
  vi.clearAllMocks()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.spyOn(window, 'alert').mockImplementation(() => {})
  host = document.createElement('div')
  root = createRoot(host)
  await act(async () => root.render(<Harness />))
})
afterEach(async () => { await act(async () => root.unmount()); vi.restoreAllMocks() })
it('preserves Windows save-path export and cancel', async () => {
  vi.mocked(invoke).mockResolvedValue('file')
  vi.mocked(save).mockResolvedValueOnce('/book.pdf').mockResolvedValueOnce(null)
  await print()
  expect(exportPdf).toHaveBeenCalledWith(expect.objectContaining({ route: 'file', outputPath: '/book.pdf' }))
  await print()
  expect(exportPdf).toHaveBeenCalledOnce()
})
it('uses the print-dialog route without requesting or promising a saved filename', async () => {
  vi.mocked(invoke).mockResolvedValue('dialog')
  await print()
  expect(save).not.toHaveBeenCalled()
  expect(exportPdf).toHaveBeenCalledWith(expect.objectContaining({ route: 'dialog', outputPath: undefined }))
  expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('cannot confirm'))
})
it('prevents duplicate actions and releases the lock after failure', async () => {
  let finish!: () => void
  vi.mocked(invoke).mockReturnValueOnce(new Promise((resolve) => { finish = () => resolve('dialog') }))
  const first = print()
  await print()
  expect(invoke).toHaveBeenCalledOnce()
  finish()
  await first
  vi.mocked(invoke).mockResolvedValueOnce('dialog')
  await print()
  expect(invoke).toHaveBeenCalledTimes(2)
})
