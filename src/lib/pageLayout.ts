import { PAGE_SIZES, type PageSizeId } from '../types/document'

export const PAGE_GAP_MM = 8
export const COLUMN_GAP_MM = 8
export const PX_PER_MM = 96 / 25.4

/** Physical geometry shared by the editable flow and PDF sheets. */
export function pageGeometry(pageSize: PageSizeId, marginMm: number) {
  const { widthMm, heightMm } = PAGE_SIZES[pageSize]
  return {
    widthMm, heightMm,
    contentHeightMm: Math.max(1, heightMm - 2 * marginMm),
    rowGapMm: 2 * marginMm + PAGE_GAP_MM,
    pageStrideMm: heightMm + PAGE_GAP_MM,
  }
}

export function sheetCountForHeight(heightPx: number, contentHeightMm: number, rowGapMm: number) {
  return Math.max(1, Math.ceil((heightPx + rowGapMm * PX_PER_MM - 1) / ((contentHeightMm + rowGapMm) * PX_PER_MM)))
}
