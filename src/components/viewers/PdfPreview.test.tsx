import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PdfPreview } from './PdfPreview'

const api = vi.hoisted(() => ({ getDocument: vi.fn(), GlobalWorkerOptions: { workerSrc: '' } }))
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => api)
let host: HTMLDivElement
let root: Root
let destroy: ReturnType<typeof vi.fn>
let cancel: ReturnType<typeof vi.fn>
let render: ReturnType<typeof vi.fn>
let getPage: ReturnType<typeof vi.fn>
beforeEach(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  destroy = vi.fn().mockResolvedValue(undefined)
  cancel = vi.fn()
  render = vi.fn().mockReturnValue({ promise: Promise.resolve(), cancel })
  getPage = vi.fn().mockResolvedValue({ getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }), render })
  api.getDocument.mockReset().mockReturnValue({ promise: Promise.resolve({ numPages: 2, getPage }), destroy })
  host = document.createElement('div')
  root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()) })
const show = async () => { await act(async () => root.render(<PdfPreview bytes={new Uint8Array([1, 2, 3])} />)) }

it('renders local PDF bytes with page navigation and bounded canvas zoom', async () => {
  await show()
  expect(api.getDocument).toHaveBeenCalledWith(expect.objectContaining({ useWorkerFetch: false, useWasm: false, enableXfa: false }))
  expect(api.getDocument.mock.calls[0][0].url).toBeUndefined()
  expect(host.querySelector('canvas')?.getAttribute('aria-label')).toBe('PDF page 1 of 2')
  const firstCanvas = host.querySelector('canvas')
  await act(async () => Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Next page')?.click())
  expect(getPage).toHaveBeenLastCalledWith(2)
  expect(cancel).toHaveBeenCalledOnce()
  expect(host.querySelector('canvas')).not.toBe(firstCanvas)
  const zoom = host.querySelector('select')!
  await act(async () => { zoom.value = '2'; zoom.dispatchEvent(new Event('change', { bubbles: true })) })
  expect(render.mock.calls.at(-1)?.[0].viewport.width).toBe(1200)
  await act(async () => root.unmount())
  expect(destroy).toHaveBeenCalledOnce()
  root = createRoot(host)
})

it('reports PDF load failures inside the tab', async () => {
  api.getDocument.mockReturnValue({ promise: Promise.reject(new Error('Password required')), destroy })
  await show()
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Password required')
})

it('does not start rendering if a delayed page resolves after unmount', async () => {
  let resolvePage: (page: unknown) => void = () => undefined
  getPage.mockImplementation(() => new Promise((resolve) => { resolvePage = resolve }))
  await show()
  await act(async () => root.unmount())
  await act(async () => resolvePage({ getViewport: () => ({ width: 600, height: 800 }), render }))
  expect(render).not.toHaveBeenCalled()
  expect(destroy).toHaveBeenCalledOnce()
  root = createRoot(host)
})
