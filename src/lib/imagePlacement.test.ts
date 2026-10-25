import { expect, it, vi } from 'vitest'
import {
  editorSheetRect,
  editorSpreadPair,
  editorStackOrigin,
  isOutsideContentMargin,
  positionImageInSpread,
  positionImageOnPage,
} from './imagePlacement'

it('moves an image in millimetres and clamps it within the physical sheet', () => {
  const page = { left: 0, top: 0, width: 420, height: 594 }
  const image = { left: 60, top: 80, width: 80, height: 100 }
  expect(positionImageOnPage(page, image, 210, 297, 40, 60)).toEqual({ xMm: 50, yMm: 70 })
  expect(positionImageOnPage(page, image, 210, 297, 1000, 1000)).toEqual({ xMm: 170, yMm: 247 })
  expect(positionImageOnPage(page, image, 210, 297, -1000, -1000)).toEqual({ xMm: 0, yMm: 0 })
})

it('uses the containing spread sheet for scale and continuous coordinates for positioning', () => {
  const page = document.createElement('div')
  page.style.width = '176mm'
  page.innerHTML = '<div data-editor-sheet="1"></div><div data-editor-sheet="2" style="top:258mm"></div><img />'
  const sheets = page.querySelectorAll<HTMLElement>('[data-editor-sheet]')
  vi.spyOn(page, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 720, 500))
  vi.spyOn(sheets[0], 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 352, 500))
  vi.spyOn(sheets[1], 'getBoundingClientRect').mockReturnValue(new DOMRect(368, 0, 352, 500))
  const image = page.querySelector('img')!
  vi.spyOn(image, 'getBoundingClientRect').mockReturnValue(new DOMRect(400, 50, 40, 80))
  expect(editorSheetRect(page, image).width).toBe(352)
  expect(editorSheetRect(page, image).left).toBe(368)
  expect(editorStackOrigin(page, image)).toEqual({ left: 368, top: -516, width: 352, height: 500 })
})

it('positions an image across both facing sheets of a spread so half sits on each page', () => {
  const layout = document.createElement('div')
  layout.dataset.pageLayout = 'spreads'
  const page = document.createElement('div')
  page.style.width = '210mm'
  page.innerHTML = '<div data-editor-sheet="1" style="top:0mm"></div><div data-editor-sheet="2" style="top:305mm"></div><img />'
  layout.append(page)
  const sheets = page.querySelectorAll<HTMLElement>('[data-editor-sheet]')
  vi.spyOn(sheets[0], 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 420, 594))
  vi.spyOn(sheets[1], 'getBoundingClientRect').mockReturnValue(new DOMRect(420, 0, 420, 594))
  const image = page.querySelector('img')!
  vi.spyOn(image, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 80, 240, 100))

  const pair = editorSpreadPair(page, image)!
  expect(pair).not.toBeNull()
  // Drag the 120mm-wide image to xMm = 150mm (60mm on page 1, 60mm on page 2).
  expect(positionImageInSpread(pair, { left: 100, top: 80, width: 240, height: 100 }, 210, 297, 200, 20)).toEqual({
    xMm: 150,
    yMm: 50,
  })
  // Dragging completely onto page 2 stores coordinates in page 2's slice.
  expect(positionImageInSpread(pair, { left: 100, top: 80, width: 240, height: 100 }, 210, 297, 400, 20)).toEqual({
    xMm: 40,
    yMm: 355,
  })
  expect(isOutsideContentMargin({ xMm: 150, yMm: 50 }, 120, 50, 210, 297, 20)).toBe(true)
  expect(isOutsideContentMargin({ xMm: 50, yMm: 70 }, 40, 50, 210, 297, 20)).toBe(false)
})
