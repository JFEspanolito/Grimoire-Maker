import { expect, it, vi } from 'vitest'
import { renderDocumentHtml } from './renderDocumentContent'
import { loadImageUrl } from '../../lib/images'

vi.mock('../../lib/images', () => ({ loadImageUrl: vi.fn(async () => 'blob:map'), revokeImageUrl: vi.fn() }))

it('renders Markdown with the page editor and leaves nothing behind in the document', async () => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', false)
  const html = await renderDocumentHtml('# Title\n\nHello **world**', '/w/Draft/a.md')
  expect(html).toContain('<h1>Title</h1>')
  expect(html).toContain('<strong>world</strong>')
  expect(document.body.children).toHaveLength(0)
})

it('rejects failed image resolution rather than treating the error chip as completed content', async () => {
  vi.mocked(loadImageUrl).mockRejectedValueOnce(new Error('Missing map asset'))
  await expect(renderDocumentHtml('![Map](missing.png)', '/w/Draft/a.md')).rejects.toThrow('image')
  expect(document.body.children).toHaveLength(0)
})

it('does not treat ordinary loading words as an image readiness signal', async () => {
  const html = await renderDocumentHtml('Loading image… is ordinary manuscript text.', null)
  expect(html).toContain('Loading image…')
  expect(document.body.children).toHaveLength(0)
})

it('waits for the actual image load and preserves a successfully decoded image', async () => {
  const src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
  vi.mocked(loadImageUrl).mockResolvedValueOnce(src)
  const pending = renderDocumentHtml('![Map](map.gif)', '/w/Draft/a.md')
  await vi.waitFor(() => expect(document.querySelector('.ProseMirror img')).not.toBeNull())
  const image = document.querySelector<HTMLImageElement>('.ProseMirror img')!
  expect(image.closest('[data-image-state]')?.getAttribute('data-image-state')).toBe('loading')
  Object.defineProperties(image, { complete: { value: true }, naturalWidth: { value: 1 } })
  image.dispatchEvent(new Event('load'))
  const html = await pending
  expect(html).toContain('data-image-state="ready"')
  expect(html).toContain(src)
  expect(document.body.children).toHaveLength(0)
})
