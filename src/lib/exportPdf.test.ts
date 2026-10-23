import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { exportPdf } from './exportPdf'

const mocks = vi.hoisted(() => ({ destroy: vi.fn(), preview: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('pagedjs', () => ({ Previewer: class {
  polisher = { destroy: mocks.destroy }
  preview = mocks.preview
} }))

const request = { pageSize: 'a4', columns: 1, theme: 'parchment', bleedMm: 0, marginMm: 12 } as const
describe('PDF lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = '<div class="grimoire-content"><div class="ProseMirror"><p>Text</p></div></div>'
    Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: Promise.resolve() } })
  })
  it('keeps paginated content through native PDF completion', async () => {
    let finish!: () => void
    vi.mocked(invoke).mockReturnValue(new Promise<void>((resolve) => { finish = resolve }))
    const pending = exportPdf({ ...request, outputPath: '/book.pdf' })
    await vi.waitFor(() => expect(invoke).toHaveBeenCalled())
    expect(document.querySelector('.print-root')).not.toBeNull()
    finish()
    await pending
    expect(document.querySelector('.print-root')).toBeNull()
    expect(mocks.destroy).toHaveBeenCalledOnce()
  })
  it('retains the print layout until afterprint, not merely until print returns', async () => {
    vi.spyOn(window, 'print').mockImplementation(() => {})
    const pending = exportPdf({ ...request, route: 'dialog' })
    await vi.waitFor(() => expect(window.print).toHaveBeenCalled())
    expect(document.querySelector('.print-root')).not.toBeNull()
    expect(document.body.classList.contains('exporting')).toBe(true)
    window.dispatchEvent(new Event('afterprint'))
    await pending
    expect(invoke).not.toHaveBeenCalled()
    expect(document.querySelector('.print-root')).toBeNull()
  })
  it('cleans styles and print DOM after native failure', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('Printer failed'))
    await expect(exportPdf({ ...request, outputPath: '/book.pdf' })).rejects.toThrow('Printer failed')
    expect(document.querySelector('.print-root')).toBeNull()
    expect(document.body.classList.contains('exporting')).toBe(false)
  })
  it('exports the active split pane and excludes simultaneous print sessions', async () => {
    document.body.innerHTML += '<section data-active-editor="true"><div class="grimoire-content"><div class="ProseMirror"><p>Active pane</p></div></div></section>'
    vi.spyOn(window, 'print').mockImplementation(() => {})
    const pending = exportPdf({ ...request, route: 'dialog' })
    await vi.waitFor(() => expect(window.print).toHaveBeenCalled())
    expect(mocks.preview.mock.calls[0]![0].textContent).toContain('Active pane')
    await expect(exportPdf({ ...request, outputPath: '/another.pdf' })).rejects.toThrow('already running')
    expect(document.querySelectorAll('.print-root')).toHaveLength(1)
    document.querySelector<HTMLButtonElement>('.print-dialog-dismiss')!.click()
    await pending
    expect(document.querySelector('.print-root')).toBeNull()
  })
  it('never falls back to an inactive document when the managed active pane is empty', async () => {
    document.body.innerHTML = '<section data-active-editor="false"><div class="grimoire-content"><div class="ProseMirror">Inactive document</div></div></section><section data-active-editor="true"></section>'
    await expect(exportPdf({ ...request, outputPath: '/book.pdf' })).rejects.toThrow('Editor content not found')
    expect(invoke).not.toHaveBeenCalled()
    expect(document.querySelector('.print-root')).toBeNull()
  })
})
