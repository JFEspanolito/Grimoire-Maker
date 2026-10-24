import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { FilePreview } from './FilePreview'

const fs = vi.hoisted(() => ({ readFile: vi.fn(), stat: vi.fn() }))
const reportError = vi.hoisted(() => vi.fn())
vi.mock('../../lib/errorLogging', () => ({ reportError }))
vi.mock('@tauri-apps/plugin-fs', () => fs)
vi.mock('./PdfPreview', () => ({ PdfPreview: () => <div>PDF page viewer</div> }))
let host: HTMLDivElement
let root: Root
beforeEach(() => {
  reportError.mockReset()
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  fs.stat.mockReset().mockResolvedValue({ size: 10 })
  fs.readFile.mockReset().mockResolvedValue(new Uint8Array([1, 2]))
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn() })
  host = document.createElement('div')
  root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals() })
const show = async (path: string) => { await act(async () => root.render(<FilePreview path={path} />)) }

it('reads images as binary blobs and revokes their URL when the tab changes', async () => {
  await show('H:/Research/map.png')
  expect(fs.readFile).toHaveBeenCalledWith('H:/Research/map.png')
  expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:preview')
  await show('H:/Research/unknown.xyz')
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview')
  expect(host.textContent).toContain('No preview')
})

it('shows Word text without injecting markup and keeps legacy DOC explicit', async () => {
  fs.readFile.mockResolvedValue(zipSync({ 'word/document.xml': strToU8('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>&lt;script&gt;unsafe&lt;/script&gt;</w:t></w:r></w:p></w:body></w:document>') }))
  await show('H:/Research/notes.docx')
  expect(host.textContent).toContain('<script>unsafe</script>')
  expect(host.querySelector('script')).toBeNull()
  await show('H:/Research/old.doc')
  expect(host.textContent).toContain('DOCX')
  expect(fs.readFile).toHaveBeenCalledTimes(1)
})

it('rejects oversized files before reading and reports unreadable images', async () => {
  fs.stat.mockResolvedValue({ size: 65 * 1024 * 1024 })
  await show('H:/Research/large.png')
  expect(fs.readFile).not.toHaveBeenCalled()
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('64 MB')
  fs.stat.mockResolvedValue({ size: 10 })
  await show('H:/Research/broken.png')
  await act(async () => host.querySelector('img')?.dispatchEvent(new Event('error')))
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('image')
  expect(reportError).toHaveBeenCalledWith('preview.image', expect.stringContaining('image'))
})

it('does not publish a stale file after changing tabs', async () => {
  let resolveRead: (bytes: Uint8Array) => void = () => undefined
  fs.readFile.mockImplementationOnce(() => new Promise<Uint8Array>((resolve) => { resolveRead = resolve }))
  await show('H:/Research/slow.png')
  await show('H:/Research/unknown.xyz')
  await act(async () => resolveRead(new Uint8Array([1])))
  expect(host.querySelector('img')).toBeNull()
  expect(URL.createObjectURL).not.toHaveBeenCalled()
})
