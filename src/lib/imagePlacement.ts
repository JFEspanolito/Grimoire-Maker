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

/** Converts a pointer delta into sheet coordinates while keeping the image within the page. */
export function positionImageOnPage(
  page: Rect, image: Rect, pageWidthMm: number, pageHeightMm: number, deltaX: number, deltaY: number,
): ImagePosition | null {
  if (page.width <= 0 || pageWidthMm <= 0 || pageHeightMm <= 0) return null
  const mmPerPx = pageWidthMm / page.width
  const clamp = (value: number, max: number) => Math.round(Math.min(Math.max(value, 0), Math.max(0, max)) * 100) / 100
  return {
    xMm: clamp((image.left - page.left + deltaX) * mmPerPx, pageWidthMm - image.width * mmPerPx),
    yMm: clamp((image.top - page.top + deltaY) * mmPerPx, pageHeightMm - image.height * mmPerPx),
  }
}
