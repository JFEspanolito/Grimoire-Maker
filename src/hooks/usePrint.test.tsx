import { useDocumentStore } from '../stores/documentStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useProjectStore } from '../stores/projectStore'
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { save } from '@tauri-apps/plugin-dialog'
import { exportPdf } from '../lib/exportPdf'
import { usePrint } from './usePrint'
import { useTabStore } from '../stores/tabStore'
import { PrintNoticeDialog } from '../components/layout/PrintNoticeDialog'
import { reportError } from '../lib/errorLogging'

vi.mock('../lib/errorLogging', () => ({ reportError: vi.fn(), friendlyErrorMessage: (error: Error) => error.message }))
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
  return <PrintNoticeDialog />
}
async function acceptNotice() {
  await act(async () => { await Promise.resolve() })
  await act(async () => host.querySelector<HTMLButtonElement>('dialog button:last-child')?.click())
}
async function completePrint() {
  const result = print()
  await acceptNotice()
  await result
}
beforeEach(async () => {
  useTabStore.getState().reset(null)
  vi.clearAllMocks()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.spyOn(window, 'alert').mockImplementation(() => {})
  HTMLDialogElement.prototype.showModal = function () { this.open = true }
  HTMLDialogElement.prototype.close = function () { this.open = false }
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  await act(async () => root.render(<Harness />))
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks() })
it('does not export an inactive Markdown editor while a binary preview is focused', async () => {
  useTabStore.getState().reset('/reference.pdf')
  await completePrint()
  expect(invoke).not.toHaveBeenCalled()
  expect(save).not.toHaveBeenCalled()
  expect(exportPdf).not.toHaveBeenCalled()
})
it('delegates Windows destination selection to Rust with only a filename suggestion', async () => {
  vi.mocked(invoke).mockResolvedValue('file')
  await completePrint()
  expect(exportPdf).toHaveBeenCalledWith(expect.objectContaining({ route: 'file', suggestedName: expect.stringMatching(/\.pdf$/) }))
  expect(vi.mocked(exportPdf).mock.calls[0]![0]).not.toHaveProperty('outputPath')
  expect(save).not.toHaveBeenCalled()
  expect(exportPdf).toHaveBeenCalledOnce()
})
it('uses the print-dialog route without requesting or promising a saved filename', async () => {
  vi.mocked(invoke).mockResolvedValue('dialog')
  await completePrint()
  expect(save).not.toHaveBeenCalled()
  expect(exportPdf).toHaveBeenCalledWith(expect.objectContaining({ route: 'dialog', suggestedName: undefined }))
  expect(window.alert).not.toHaveBeenCalled()
})
it('does not depend on browser alerts to explain the system print dialog', async () => {
  vi.mocked(invoke).mockResolvedValue('dialog')
  await completePrint()
  expect(window.alert).not.toHaveBeenCalled()
})
it('prevents duplicate actions and releases the lock after failure', async () => {
  let finish!: () => void
  vi.mocked(invoke).mockReturnValueOnce(new Promise((resolve) => { finish = () => resolve('dialog') }))
  const first = print()
  await completePrint()
  expect(invoke).toHaveBeenCalledOnce()
  finish()
  await acceptNotice()
  await first
  vi.mocked(invoke).mockResolvedValueOnce('dialog')
  await completePrint()
  expect(invoke).toHaveBeenCalledTimes(2)
})

it('exports page-specific columns and project credits without taking a page author override', async () => {
  vi.mocked(invoke).mockResolvedValue('dialog')
  useSettingsStore.setState({ columns: 2 })
  useDocumentStore.getState().setWorkspace('/book', [])
  useDocumentStore.getState().loadFromRaw('/book/a.md', '---\ncolumns: 1\nauthor: Ignored\n---\nA')
  useProjectStore.setState({ entries: { '/book': { ready: true, busy: false, error: '', settings: { name: 'Book', author: 'Alice', coAuthor: 'Bob' } } } })
  await completePrint()
  expect(exportPdf).toHaveBeenCalledWith(expect.objectContaining({ columns: 1, pageText: expect.objectContaining({ author: 'Alice', coAuthor: 'Bob' }) }))
  expect(useSettingsStore.getState().columns).toBe(2)
  useDocumentStore.getState().resetDocuments()
  useDocumentStore.getState().setWorkspace(null, [])
})

it('waits for the app dialog and cancels without exporting', async () => {
  vi.mocked(invoke).mockResolvedValue('dialog')
  const result = print()
  await act(async () => { await Promise.resolve() })
  expect(host.querySelector('dialog')?.open).toBe(true)
  expect(host.textContent).toContain('cannot confirm')
  expect(exportPdf).not.toHaveBeenCalled()
  await act(async () => host.querySelector<HTMLButtonElement>('dialog button')!.click())
  await result
  expect(exportPdf).not.toHaveBeenCalled()
})
it('reports export failures in the app dialog and permits a later attempt', async () => {
  vi.mocked(invoke).mockResolvedValue('file')
  vi.mocked(exportPdf).mockRejectedValueOnce(new Error('Disk full'))
  const result = print()
  await act(async () => { await Promise.resolve() })
  expect(host.textContent).toContain('Disk full')
  expect(reportError).toHaveBeenCalledWith('pdf.export', expect.any(Error))
  expect(host.querySelectorAll('dialog button')).toHaveLength(1)
  await acceptNotice()
  await result
  await completePrint()
  expect(exportPdf).toHaveBeenCalledTimes(2)
  expect(window.alert).not.toHaveBeenCalled()
})
it('settles a pending print notice when its host unmounts', async () => {
  vi.mocked(invoke).mockResolvedValue('dialog')
  const result = print()
  await act(async () => { await Promise.resolve() })
  await act(async () => root.render(null))
  await result
  expect(exportPdf).not.toHaveBeenCalled()
})
