import { expect, it } from 'vitest'
import { pageGeometry, PX_PER_MM, sheetCountForHeight } from './pageLayout'

it('keeps physical paper dimensions and usable height separate from inter-page spacing', () => {
  expect(pageGeometry('a4', 20)).toEqual({ widthMm: 210, heightMm: 297, contentHeightMm: 257, rowGapMm: 48, pageStrideMm: 305 })
  expect(pageGeometry('letter', 10).heightMm).toBe(279.4)
  expect(pageGeometry('b5', 200).contentHeightMm).toBe(1)
})

it('counts a second sheet only when content extends beyond the first sheet tolerance', () => {
  expect(sheetCountForHeight(0, 257, 48)).toBe(1)
  expect(sheetCountForHeight(257 * PX_PER_MM, 257, 48)).toBe(1)
  expect(sheetCountForHeight(257 * PX_PER_MM + 2, 257, 48)).toBe(2)
  expect(sheetCountForHeight((257 * 2 + 48) * PX_PER_MM, 257, 48)).toBe(2)
})
