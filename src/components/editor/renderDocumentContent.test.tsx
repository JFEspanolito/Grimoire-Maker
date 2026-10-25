import { expect, it, vi } from 'vitest'
import { renderDocumentHtml } from './renderDocumentContent'

vi.mock('../../lib/images', () => ({ loadImageUrl: vi.fn(async () => 'blob:map'), revokeImageUrl: vi.fn() }))

it('renders Markdown with the page editor and leaves nothing behind in the document', async () => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', false)
  const html = await renderDocumentHtml('# Title\n\nHello **world**', '/w/Draft/a.md')
  expect(html).toContain('<h1>Title</h1>')
  expect(html).toContain('<strong>world</strong>')
  expect(document.body.children).toHaveLength(0)
})
