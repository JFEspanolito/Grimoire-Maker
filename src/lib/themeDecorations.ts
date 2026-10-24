export const MAX_THEME_BYTES = 24 * 1024 * 1024
export const MAX_DECORATION_BYTES = 2 * 1024 * 1024
const MAX_EMBEDDED_CHARACTERS = 8 * 1024 * 1024
const BLOCK = /\/\* grimoire-backgrounds:start ([^\r\n]*?) \*\/[\s\S]*?\/\* grimoire-backgrounds:end \*\//g
export const DECORATION_ANCHORS = ['header', 'footer'] as const
export type DecorationAnchor = (typeof DECORATION_ANCHORS)[number]
export interface ThemeDecoration {
  id: string
  name: string
  dataUrl: string
  widthMm: number
  heightMm: number
  xMm: number
  yMm: number
  anchor: DecorationAnchor
}

/** Only embedded, inert raster images cross the saved-theme boundary. */
export function validateDecorations(value: unknown): ThemeDecoration[] {
  if (!Array.isArray(value) || value.length > 32) throw new Error('Use at most 32 background images.')
  const ids = new Set<string>()
  let total = 0
  return value.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object') throw new Error('Invalid background image.')
    const item = entry as Record<string, unknown>
    if (typeof item.id !== 'string' || !/^[\w-]{1,80}$/.test(item.id) || ids.has(item.id)) throw new Error('Invalid background image ID.')
    ids.add(item.id)
    if (typeof item.name !== 'string' || item.name.length > 120) throw new Error('Invalid background image name.')
    if (typeof item.dataUrl !== 'string' || item.dataUrl.length > MAX_DECORATION_BYTES * 4 / 3 + 100
      || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(item.dataUrl)) throw new Error('Backgrounds must be embedded PNG, JPEG or WebP images up to 2 MB.')
    const bytes = atob(item.dataUrl.slice(item.dataUrl.indexOf(',') + 1))
    const png = bytes.startsWith('\x89PNG\r\n\x1a\n')
    const jpeg = bytes.startsWith('\xff\xd8\xff')
    const webp = bytes.startsWith('RIFF') && bytes.slice(8, 12) === 'WEBP'
    if (bytes.length > MAX_DECORATION_BYTES || !(png || jpeg || webp)) throw new Error('Invalid raster image data.')
    total += item.dataUrl.length
    if (total > MAX_EMBEDDED_CHARACTERS) throw new Error('The combined background images exceed 8 MB. Use smaller images.')
    const dimension = (key: string, minimum: number) => {
      const number = item[key]
      if (typeof number !== 'number' || !Number.isFinite(number) || number < minimum || number > 1000) throw new Error(`Invalid background ${key}.`)
      return number
    }
    if (item.anchor !== 'header' && item.anchor !== 'footer') throw new Error('Invalid background anchor.')
    return { id: item.id, name: item.name, dataUrl: item.dataUrl, anchor: item.anchor,
      widthMm: dimension('widthMm', 1), heightMm: dimension('heightMm', 1), xMm: dimension('xMm', 0), yMm: dimension('yMm', 0) }
  })
}

export function readThemeDecorations(css: string): ThemeDecoration[] {
  const match = [...css.matchAll(BLOCK)].at(-1)
  if (!match) {
    if (css.includes('/* grimoire-backgrounds:start')) throw new Error('The theme background metadata is damaged.')
    return []
  }
  return validateDecorations(JSON.parse(decodeURIComponent(match[1])))
}

export function stripDecorationCss(css: string): string { return css.replace(BLOCK, '') }

export function decorationCss(id: string, decorations: ThemeDecoration[]): string {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('Invalid theme ID.')
  const items = validateDecorations(decorations)
  if (!items.length) return ''
  // Metadata is escaped; image URLs and every interpolated coordinate are validated above.
  return `/* grimoire-backgrounds:start ${encodeURIComponent(JSON.stringify(items))} */
[data-theme='${id}'] .grimoire-page, .grimoire-page[data-theme='${id}'], [data-theme='${id}'] .pagedjs_pagebox {
  background-image: ${items.map(item => `url("${item.dataUrl}")`).join(', ')};
  background-size: ${items.map(item => `${item.widthMm}mm ${item.heightMm}mm`).join(', ')};
  background-position: ${items.map(item => `left ${item.xMm}mm ${item.anchor === 'footer' ? 'bottom' : 'top'} ${item.yMm}mm`).join(', ')};
  background-repeat: no-repeat;
}
[data-theme='${id}'] .pagedjs_page .grimoire-page { background-color: transparent !important; background-image: none !important; }
/* grimoire-backgrounds:end */`
}

export function moveDecoration(item: ThemeDecoration, dxMm: number, dyMm: number, widthMm: number, heightMm: number): ThemeDecoration {
  const top = item.anchor === 'footer' ? heightMm - item.yMm - item.heightMm : item.yMm
  const y = Math.max(0, Math.min(heightMm - item.heightMm, top + dyMm))
  const footer = y + item.heightMm / 2 > heightMm / 2
  const round = (number: number) => Math.round(number * 100) / 100
  return { ...item, xMm: round(Math.max(0, Math.min(widthMm - item.widthMm, item.xMm + dxMm))),
    yMm: round(footer ? Math.max(0, heightMm - y - item.heightMm) : y), anchor: footer ? 'footer' : 'header' }
}

/** Wait for the selected theme's embedded images before pagination or native printing. */
export async function prepareThemeBackgrounds(theme: string): Promise<void> {
  const scope = document.createElement('div')
  scope.dataset.theme = theme
  scope.style.cssText = 'position:fixed;left:-10000px;width:0;height:0;pointer-events:none'
  const probe = document.createElement('div')
  probe.className = 'pagedjs_pagebox'
  scope.append(probe)
  document.body.append(scope)
  const background = getComputedStyle(probe).backgroundImage
  scope.remove()
  const sources = new Set([...background.matchAll(/url\(["']?(data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+)["']?\)/g)].map(match => match[1]))
  await Promise.all([...sources].map(src => new Promise<void>((resolve, reject) => {
    const image = new Image()
    const timer = window.setTimeout(() => { image.onload = null; image.onerror = null; reject(new Error('Background image loading timed out.')) }, 15000)
    const finish = (error?: Error) => {
      clearTimeout(timer)
      image.onload = null
      image.onerror = null
      if (error) reject(error)
      else resolve()
    }
    image.onload = () => finish()
    image.onerror = () => finish(new Error('Could not decode a theme background image.'))
    image.src = src
  })))
}
