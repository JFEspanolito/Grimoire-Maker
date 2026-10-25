import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { renderNativePages } from './nativePageExport'
import { PX_PER_MM } from './pageLayout'

const request = { pageSize: 'b5', columns: 2, theme: 'parchment', bleedMm: 3, marginMm: 15 } as const
beforeEach(() => {
  vi.stubGlobal('CSS', { supports: () => true })
  Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: Promise.resolve() } })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren() })

it('uses native wrapped column height, not H1 count, to create physical sheets including bleed', async () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return { height: this.dataset.paginated ? (220 * 2 + 38) * PX_PER_MM : 0 } as DOMRect
  })
  const content = document.createElement('div')
  content.innerHTML = '<div class="grimoire-content"><div class="ProseMirror">' + '<h1>Section</h1><p>Body</p>'.repeat(7) + '</div></div>'
  const target = document.createElement('div')
  document.body.append(target)
  await renderNativePages({ ...request,
    headerFooter: { header: { left: '{author}', center: '', right: '' }, footer: { left: '', center: '{page}/{pages}', right: '' } },
    pageText: { author: '<b>Author</b>' },
  }, target, content)
  const pages = target.querySelectorAll<HTMLElement>('[data-print-sheet]')
  expect(pages).toHaveLength(2)
  expect(pages[0].style.width).toBe('182mm')
  expect(pages[0].style.height).toBe('256mm')
  expect(target.querySelector('[data-native-measure]')).toBeNull()
  expect(pages[1].querySelector<HTMLElement>('[data-print-flow]')?.style.top).toBe('-258mm')
  expect(pages[0].querySelector('[data-paginated]')?.getAttribute('data-paginated')).toBe('true')
  expect(content.querySelectorAll('h1')).toHaveLength(7)
  expect(target.querySelectorAll('[data-theme-page-text]')).toHaveLength(2)
  expect(pages[0].textContent).toContain('<b>Author</b>1/2')
  expect(pages[1].textContent).toContain('<b>Author</b>2/2')
  expect(target.querySelector('b')).toBeNull()
})

it('rejects unsupported native pagination rather than silently exporting different pages', async () => {
  vi.stubGlobal('CSS', { supports: () => false })
  await expect(renderNativePages(request, document.createElement('div'), document.createElement('div'))).rejects.toThrow('newer WebView')
})

it.each([0, 3])('prints crop and registration marks only when bleed is enabled (%s mm)', async bleedMm => {
  const target = document.createElement('div')
  document.body.append(target)
  await renderNativePages({ ...request, bleedMm }, target, document.createElement('div'))
  expect(target.querySelectorAll('[data-print-mark="crop"]')).toHaveLength(bleedMm ? 8 : 0)
  expect(target.querySelectorAll('[data-print-mark="cross"]')).toHaveLength(bleedMm ? 4 : 0)
  const marks = target.querySelector('svg[data-print-marks]')
  if (bleedMm) {
    expect(marks?.getAttribute('viewBox')).toBe('0 0 182 256')
    expect(marks?.getAttribute('aria-hidden')).toBe('true')
    expect(target.querySelector<HTMLElement>('.native-print-trim')?.style.width).toBe('176mm')
  } else expect(marks).toBeNull()
})

it('splits a spread-spanning image across both facing PDF pages', async () => {
  const content = document.createElement('div')
  content.innerHTML = '<div class="grimoire-content"><div class="ProseMirror"><div class="grimoire-image" data-anchor="free"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" data-x-mm="116" data-y-mm="40" data-width-mm="120" style="left:116mm;top:40mm;width:120mm" /></div></div></div>'
  Object.defineProperty(HTMLImageElement.prototype, 'complete', { configurable: true, get: () => true })
  Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', { configurable: true, get: () => 100 })
  const target = document.createElement('div')
  document.body.append(target)

  await renderNativePages(request, target, content)

  const pages = target.querySelectorAll<HTMLElement>('[data-print-sheet]')
  expect(pages).toHaveLength(2)
  const firstImg = pages[0].querySelector<HTMLElement>('img')!
  const secondImg = pages[1].querySelector<HTMLElement>('img')!
  expect(firstImg.style.left).toBe('116mm')
  expect(firstImg.style.top).toBe('40mm')
  // Right sheet shifts the image by -widthMm (-176mm) horizontally and +pageStrideMm (+258mm) vertically.
  expect(secondImg.style.left).toBe('-60mm')
  expect(secondImg.style.top).toBe('298mm')
})
