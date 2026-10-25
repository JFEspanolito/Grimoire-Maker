import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PageHeaderFooter } from '../components/editor/PageHeaderFooter'
import flowStyles from '../components/editor/PageView.module.css'
import type { PageRequest } from './exportPdf'
import { pageGeometry, PX_PER_MM, sheetCountForHeight } from './pageLayout'
import { alignSections } from './sectionLayout'

const FREE_SELECTOR = '.grimoire-image[data-anchor="free"] img, img[data-anchor="free"], .grimoire-content-box[data-placement="free"]'

function parseMm(attr: string | null, styleValue: string): number | null {
  const raw = attr ?? (styleValue.endsWith('mm') ? styleValue.slice(0, -2) : null)
  if (raw === null || raw === '') return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

function freeElementGeometry(element: HTMLElement) {
  const xMm = parseMm(element.getAttribute('data-x-mm'), element.style.left) ?? 0
  const yMm = parseMm(element.getAttribute('data-y-mm'), element.style.top) ?? 0
  const widthMm = parseMm(element.getAttribute('data-width-mm'), element.style.width)
    ?? (element.getBoundingClientRect().width / PX_PER_MM)
  return { xMm, yMm, widthMm }
}

/** Vector crop and registration marks live entirely outside the finished page. */
function printMarks(widthMm: number, heightMm: number, bleedMm: number): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  const width = widthMm + 2 * bleedMm
  const height = heightMm + 2 * bleedMm
  const gap = Math.min(.5, bleedMm / 4)
  svg.setAttribute('data-print-marks', '')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', '#000')
  svg.setAttribute('stroke-width', String(Math.min(.15, bleedMm / 10)))
  svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none'
  const path = (kind: string, d: string) => {
    const mark = document.createElementNS(ns, 'path')
    mark.setAttribute('data-print-mark', kind)
    mark.setAttribute('d', d)
    svg.append(mark)
  }
  for (const y of [bleedMm, height - bleedMm]) {
    path('crop', `M 0 ${y} H ${bleedMm - gap}`)
    path('crop', `M ${width - bleedMm + gap} ${y} H ${width}`)
  }
  for (const x of [bleedMm, width - bleedMm]) {
    path('crop', `M ${x} 0 V ${bleedMm - gap}`)
    path('crop', `M ${x} ${height - bleedMm + gap} V ${height}`)
  }
  const arm = Math.min(1.5, bleedMm / 2 - gap)
  const radius = arm / 2
  for (const [x, y] of [[width / 2, bleedMm / 2], [width / 2, height - bleedMm / 2], [bleedMm / 2, height / 2], [width - bleedMm / 2, height / 2]]) {
    path('cross', `M ${x - arm} ${y} H ${x + arm} M ${x} ${y - arm} V ${y + arm} M ${x - radius} ${y} a ${radius} ${radius} 0 1 0 ${2 * radius} 0 a ${radius} ${radius} 0 1 0 ${-2 * radius} 0`)
  }
  return svg
}

async function waitForImages(content: HTMLElement) {
  await Promise.all(Array.from(content.querySelectorAll('img'), image => new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => finish(new Error('Image loading timed out before PDF export.')), 15000)
    const finish = (error?: Error) => {
      window.clearTimeout(timer)
      image.removeEventListener('load', loaded)
      image.removeEventListener('error', failed)
      if (error) reject(error)
      else resolve()
    }
    const loaded = () => finish()
    const failed = () => finish(new Error('An image could not be loaded for PDF export.'))
    image.addEventListener('load', loaded, { once: true })
    image.addEventListener('error', failed, { once: true })
    if (image.complete) image.naturalWidth ? loaded() : failed()
  })))
}

/** Render the editor's native column flow once, then print its physical sheet windows. */
export async function renderNativePages(request: PageRequest, target: HTMLElement, content: HTMLElement): Promise<void> {
  if (typeof CSS === 'undefined' || !CSS.supports?.('column-wrap', 'wrap') || !CSS.supports('column-height', '100px')) {
    throw new Error('Matching PDF pagination requires a newer WebView with wrapped columns.')
  }
  const { widthMm, heightMm, contentHeightMm, rowGapMm, pageStrideMm } = pageGeometry(request.pageSize, request.marginMm)
  const measure = document.createElement('div')
  measure.dataset.nativeMeasure = 'true'
  measure.dataset.theme = request.theme
  measure.className = 'grimoire-page'
  measure.style.cssText = `position:relative;width:${widthMm}mm;min-height:${heightMm}mm;padding:${request.marginMm}mm;background:none!important;box-sizing:border-box`
  const flow = document.createElement('div')
  flow.className = flowStyles.flow
  flow.dataset.paginated = 'true'
  flow.style.setProperty('--page-columns', String(request.columns))
  flow.style.setProperty('--content-height', `${contentHeightMm}mm`)
  flow.style.setProperty('--row-gap', `${rowGapMm}mm`)
  flow.append(...Array.from(content.childNodes, node => node.cloneNode(true)))
  measure.append(flow)
  target.append(measure)
  try {
    await document.fonts.ready
    await waitForImages(measure)
    alignSections(flow)
    let count = sheetCountForHeight(flow.getBoundingClientRect().height, contentHeightMm, rowGapMm)
    measure.querySelectorAll<HTMLElement>(FREE_SELECTOR).forEach(element => {
      const { xMm, yMm, widthMm: elWidthMm } = freeElementGeometry(element)
      const sheetIndex = Math.max(0, Math.floor(yMm / pageStrideMm))
      const spansSpread = sheetIndex % 2 === 0 && xMm < widthMm && xMm + elWidthMm > widthMm
      count = Math.max(count, spansSpread ? sheetIndex + 2 : sheetIndex + 1)
    })
    const printStyle = document.createElement('style')
    printStyle.dataset.nativePrintStyle = 'true'
    printStyle.textContent = `@page { size: ${widthMm + 2 * request.bleedMm}mm ${heightMm + 2 * request.bleedMm}mm; margin: 0; }`
    target.append(printStyle)
    for (let index = 0; index < count; index++) {
      const sheet = document.createElement('div')
      sheet.dataset.printSheet = String(index + 1)
      sheet.className = 'native-print-sheet'
      sheet.style.cssText = `width:${widthMm + 2 * request.bleedMm}mm;height:${heightMm + 2 * request.bleedMm}mm;padding:${request.bleedMm}mm;box-sizing:border-box`
      const trim = document.createElement('div')
      trim.className = 'grimoire-page native-print-trim'
      trim.style.cssText = `width:${widthMm}mm;height:${heightMm}mm;position:relative;overflow:hidden`
      const copy = measure.cloneNode(true) as HTMLElement
      copy.removeAttribute('data-native-measure')
      copy.dataset.printFlow = 'true'
      copy.style.position = 'absolute'
      copy.style.top = `${-index * pageStrideMm}mm`
      copy.style.left = '0'
      if (index % 2 === 1) {
        copy.querySelectorAll<HTMLElement>(FREE_SELECTOR).forEach(element => {
          const { xMm, yMm, widthMm: elWidthMm } = freeElementGeometry(element)
          const sheetIndex = Math.max(0, Math.floor(yMm / pageStrideMm))
          if (sheetIndex === index - 1 && xMm < widthMm && xMm + elWidthMm > widthMm) {
            element.style.position = 'absolute'
            element.style.left = `${Math.round((xMm - widthMm) * 100) / 100}mm`
            element.style.top = `${Math.round((yMm + pageStrideMm) * 100) / 100}mm`
            element.style.width = `${elWidthMm}mm`
          }
        })
      }
      trim.append(copy)
      trim.insertAdjacentHTML('beforeend', renderToStaticMarkup(createElement(PageHeaderFooter, {
        layout: request.headerFooter,
        context: { ...request.pageText, page: index + 1, pages: count },
        marginMm: request.marginMm,
      })))
      sheet.append(trim)
      if (request.bleedMm > 0) sheet.append(printMarks(widthMm, heightMm, request.bleedMm))
      target.append(sheet)
    }
    // The physical copies own fresh image elements; printing must not race their loads.
    await waitForImages(target)
  } finally {
    measure.remove()
  }
}
