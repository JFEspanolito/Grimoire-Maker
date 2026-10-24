import { expect, it, vi } from 'vitest'
import { decorationCss, readThemeDecorations, moveDecoration, validateDecorations, prepareThemeBackgrounds } from './themeDecorations'
import { buildThemeCss, themeColors } from './themeEditor'

const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM/8AAAAASUVORK5CYII='
const flower = { id: 'flower', name: 'Flowers', dataUrl: image, widthMm: 40, heightMm: 40, xMm: 5, yMm: 3, anchor: 'header' as const }

it('round-trips multiple portable images and anchors them to every trimmed page', () => {
  const roots = { ...flower, id: 'roots', name: 'Roots', anchor: 'footer' as const }
  const css = decorationCss('garden', [flower, roots])
  expect(readThemeDecorations(css)).toEqual([flower, roots])
  expect(css).toContain("[data-theme='garden'] .pagedjs_pagebox")
  expect(css).toContain('left 5mm bottom 3mm')
  expect(css).toContain('background-image: none !important')
  expect(css).not.toContain('file:')
  const saved = buildThemeCss(css, 'garden', 'copy', 'Garden Copy', themeColors(''))
  expect(readThemeDecorations(saved)).toEqual([flower, roots])
  expect(saved).toContain("[data-theme='copy'] .pagedjs_pagebox")
})

it('rejects executable image URLs and invalid layout instead of saving unsafe CSS', () => {
  for (const dataUrl of ['data:image/svg+xml;base64,PHN2Zz4=', 'file:///flowers.png', 'https://example.com/image.png']) {
    expect(() => validateDecorations([{ ...flower, dataUrl }])).toThrow()
  }
  expect(() => validateDecorations([{ ...flower, widthMm: Infinity }])).toThrow()
  expect(() => validateDecorations([flower, flower])).toThrow()
})

it('converts preview drag into footer coordinates and bounds the image to the page', () => {
  expect(moveDecoration(flower, 10, 250, 210, 297)).toMatchObject({ xMm: 15, yMm: 4, anchor: 'footer' })
  expect(moveDecoration(flower, 1000, -1000, 210, 297)).toMatchObject({ xMm: 170, yMm: 0, anchor: 'header' })
})

it('waits for background image readiness and removes its offscreen probe', async () => {
  const instance: { onload: (() => void) | null; onerror: (() => void) | null; src: string } = { onload: null, onerror: null, src: '' }
  vi.stubGlobal('Image', vi.fn(function () { return instance }))
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({ backgroundImage: `url("${image}")` } as CSSStyleDeclaration)
  try {
    let complete = false
    const pending = prepareThemeBackgrounds('garden').then(() => { complete = true })
    expect(instance.src).toBe(image)
    expect(complete).toBe(false)
    expect(document.querySelector('.pagedjs_pagebox')).toBeNull()
    instance.onload?.()
    await pending
    expect(complete).toBe(true)
  } finally { vi.restoreAllMocks(); vi.unstubAllGlobals() }
})
