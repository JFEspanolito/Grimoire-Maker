interface Rect {
  left: number
  top: number
  width: number
  height: number
}

export interface ImagePosition {
  xMm: number
  yMm: number
}

export interface SpreadSheetPair {
  left: DOMRect
  right: DOMRect | null
  leftLogicalTopMm: number
  rightLogicalTopMm: number
}

/** Converts a pointer delta into sheet coordinates while keeping the image within the page or spread. */
export function positionImageOnPage(
  page: Rect,
  image: Rect,
  pageWidthMm: number,
  pageHeightMm: number,
  deltaX: number,
  deltaY: number,
  surfaceWidthMm = pageWidthMm,
): ImagePosition | null {
  if (page.width <= 0 || pageWidthMm <= 0 || pageHeightMm <= 0 || surfaceWidthMm <= 0) return null
  const mmPerPx = pageWidthMm / page.width
  const clamp = (value: number, max: number) => Math.round(Math.min(Math.max(value, 0), Math.max(0, max)) * 100) / 100
  return {
    xMm: clamp((image.left - page.left + deltaX) * mmPerPx, surfaceWidthMm - image.width * mmPerPx),
    yMm: clamp((image.top - page.top + deltaY) * mmPerPx, pageHeightMm - image.height * mmPerPx),
  }
}

/** Pick the physical sheet anchoring a node, preferring its left edge when spanning a spread. */
export function editorSheetRect(page: Element, reference: Element): DOMRect {
  const rect = reference.getBoundingClientRect()
  const sheets = Array.from(page.querySelectorAll('[data-editor-sheet]'))
  const candidates = sheets.map(sheet => sheet.getBoundingClientRect()).filter(sheet => sheet.width > 0)
  return candidates.find(sheet => rect.left >= sheet.left - 1
    && rect.left < sheet.right && rect.top < sheet.bottom && rect.bottom > sheet.top)
    ?? candidates.find(sheet => rect.left + rect.width / 2 >= sheet.left
      && rect.left + rect.width / 2 <= sheet.right && rect.top < sheet.bottom && rect.bottom > sheet.top)
    ?? candidates[0] ?? page.getBoundingClientRect()
}

/** Absolute nodes use the continuous stack's logical Y even in a fragmented spread. */
export function editorStackOrigin(page: Element, reference: Element): Rect {
  const bounds = editorSheetRect(page, reference)
  const sheets = Array.from(page.querySelectorAll<HTMLElement>('[data-editor-sheet]'))
  const sheet = sheets.find(item => {
    const rect = item.getBoundingClientRect()
    return Math.abs(rect.left - bounds.left) < 1 && Math.abs(rect.top - bounds.top) < 1
  })
  const widthMm = parseFloat((page as HTMLElement).style.width)
  const logicalTopMm = parseFloat(sheet?.style.top ?? '0') || 0
  return { left: bounds.left, top: bounds.top - (widthMm > 0 ? logicalTopMm * bounds.width / widthMm : 0), width: bounds.width, height: bounds.height }
}

/** Resolves the left and right sheets of the spread row containing `reference`. */
export function editorSpreadPair(page: Element, reference: Element): SpreadSheetPair | null {
  if (!page.closest('[data-page-layout="spreads"]')) return null
  const sheets = Array.from(page.querySelectorAll<HTMLElement>('[data-editor-sheet]'))
  const rects = sheets.map(sheet => ({ sheet, rect: sheet.getBoundingClientRect() })).filter(item => item.rect.width > 0)
  if (!rects.length) return null
  const anchor = editorSheetRect(page, reference)
  const matchIndex = Math.max(0, rects.findIndex(item => Math.abs(item.rect.left - anchor.left) < 1 && Math.abs(item.rect.top - anchor.top) < 1))
  const leftIndex = matchIndex - (matchIndex % 2)
  const leftItem = rects[leftIndex]
  const rightItem = rects[leftIndex + 1]
  if (!leftItem) return null
  const leftTop = parseFloat(leftItem.sheet.style.top ?? '0') || 0
  const rightTop = rightItem ? (parseFloat(rightItem.sheet.style.top ?? '0') || 0) : leftTop
  return {
    left: leftItem.rect,
    right: rightItem?.rect ?? null,
    leftLogicalTopMm: leftTop,
    rightLogicalTopMm: rightTop,
  }
}

/** Positions an image across a two-page spread, anchoring to the left sheet when spanning the spine. */
export function positionImageInSpread(
  pair: SpreadSheetPair,
  image: Rect,
  pageWidthMm: number,
  pageHeightMm: number,
  deltaX: number,
  deltaY: number,
): ImagePosition | null {
  const surfaceWidthMm = pair.right ? 2 * pageWidthMm : pageWidthMm
  const raw = positionImageOnPage(pair.left, image, pageWidthMm, pageHeightMm, deltaX, deltaY, surfaceWidthMm)
  if (!raw) return null
  if (!pair.right || raw.xMm < pageWidthMm) {
    return {
      xMm: raw.xMm,
      yMm: Math.round((pair.leftLogicalTopMm + raw.yMm) * 100) / 100,
    }
  }
  return {
    xMm: Math.round((raw.xMm - pageWidthMm) * 100) / 100,
    yMm: Math.round((pair.rightLogicalTopMm + raw.yMm) * 100) / 100,
  }
}

/** Whether a dragged image rectangle extends outside a sheet's editable content margin box. */
export function isOutsideContentMargin(
  position: ImagePosition,
  imageWidthMm: number,
  imageHeightMm: number,
  pageWidthMm: number,
  pageHeightMm: number,
  marginMm: number,
  pageStrideMm = pageHeightMm + 8,
): boolean {
  const localYMm = pageStrideMm > 0 ? ((position.yMm % pageStrideMm) + pageStrideMm) % pageStrideMm : position.yMm
  return (
    position.xMm < marginMm ||
    position.xMm + imageWidthMm > pageWidthMm - marginMm ||
    localYMm < marginMm ||
    localYMm + imageHeightMm > pageHeightMm - marginMm
  )
}
