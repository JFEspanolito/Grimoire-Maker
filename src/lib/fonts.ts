export interface FontOption {
  id: string
  label: string
  family: string
}

export const BASE_FONTS: FontOption[] = [
  { id: 'georgia', label: 'Georgia (Serif)', family: 'Georgia, serif' },
  { id: 'garamond', label: 'Garamond (Serif)', family: 'Garamond, "Times New Roman", serif' },
  { id: 'baskerville', label: 'Baskerville (Serif)', family: 'Baskerville, Georgia, serif' },
  { id: 'cinzel', label: 'Cinzel (Fantasy)', family: 'Cinzel, Georgia, serif' },
  { id: 'arial', label: 'Arial (Sans)', family: 'Arial, Helvetica, sans-serif' },
  { id: 'trebuchet', label: 'Trebuchet MS (Sans)', family: '"Trebuchet MS", sans-serif' },
  { id: 'bahnschrift', label: 'Bahnschrift (Display)', family: 'Bahnschrift, sans-serif' },
  { id: 'courier', label: 'Courier New (Mono)', family: '"Courier New", monospace' },
]

const SYSTEM_FONTS = new Set([
  'georgia',
  'garamond',
  'baskerville',
  'arial',
  'helvetica',
  'trebuchet ms',
  'bahnschrift',
  'courier new',
  'times new roman',
  'verdana',
  'tahoma',
  'segoe ui',
])

export function extractFontName(entry: string): string {
  const trimmed = entry.trim()
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed)
      const family = url.searchParams.get('family')
      if (family) {
        return family.split(':')[0].replace(/\+/g, ' ').trim()
      }
    } catch {
      // ignore
    }
  }
  const filename = trimmed.split(/[\\/]/).at(-1) ?? trimmed
  return filename.replace(/\.(ttf|otf|woff2?)$/i, '').replace(/['"]/g, '').trim()
}

export function arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  let binary = ''
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  const len = bytes.byteLength
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

export function injectLocalFontFace(fontName: string, dataUrl: string): void {
  if (typeof document === 'undefined') return
  const id = `grimoire-local-font-${fontName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`
  if (document.getElementById(id)) return
  const style = document.createElement('style')
  style.id = id
  style.textContent = `@font-face { font-family: '${fontName}'; src: url('${dataUrl}'); font-display: swap; }`
  document.head.appendChild(style)
}

export async function registerFontFile(file: File): Promise<string> {
  const fontName = extractFontName(file.name)
  const buffer = await file.arrayBuffer()
  if (typeof window !== 'undefined' && typeof FontFace !== 'undefined') {
    try {
      const fontFace = new FontFace(fontName, buffer)
      await fontFace.load()
      document.fonts.add(fontFace)
    } catch {
      // FontFace may fail on older or test environments; fallback to @font-face style
    }
  }
  const mime = file.name.endsWith('.woff2')
    ? 'font/woff2'
    : file.name.endsWith('.woff')
      ? 'font/woff'
      : file.name.endsWith('.otf')
        ? 'font/otf'
        : 'font/ttf'
  const dataUrl = `data:${mime};base64,${arrayBufferToBase64(buffer)}`
  injectLocalFontFace(fontName, dataUrl)
  return fontName
}

export async function registerFontBytes(name: string, bytes: Uint8Array): Promise<string> {
  const fontName = extractFontName(name)
  if (typeof window !== 'undefined' && typeof FontFace !== 'undefined') {
    try {
      const fontFace = new FontFace(fontName, bytes.buffer)
      await fontFace.load()
      document.fonts.add(fontFace)
    } catch {
      // ignore
    }
  }
  const mime = name.endsWith('.woff2')
    ? 'font/woff2'
    : name.endsWith('.woff')
      ? 'font/woff'
      : name.endsWith('.otf')
        ? 'font/otf'
        : 'font/ttf'
  const dataUrl = `data:${mime};base64,${arrayBufferToBase64(bytes)}`
  injectLocalFontFace(fontName, dataUrl)
  return fontName
}

export function loadExternalFont(nameOrUrl: string): void {
  if (typeof document === 'undefined') return
  const trimmed = nameOrUrl.trim()
  if (!trimmed) return

  // Full URL
  if (/^https?:\/\//i.test(trimmed)) {
    const id = `grimoire-font-${encodeURIComponent(trimmed).slice(0, 32)}`
    if (document.getElementById(id)) return
    const link = document.createElement('link')
    link.id = id
    link.rel = 'stylesheet'
    link.href = trimmed
    document.head.appendChild(link)
    return
  }

  const cleanName = extractFontName(trimmed)
  if (!cleanName || SYSTEM_FONTS.has(cleanName.toLowerCase())) return
  const id = `grimoire-font-${cleanName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`
  if (document.getElementById(id)) return
  const link = document.createElement('link')
  link.id = id
  link.rel = 'stylesheet'
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(cleanName).replace(/%20/g, '+')}&display=swap`
  document.head.appendChild(link)
}

export function getAllFonts(customFonts: string[] = []): FontOption[] {
  const customOptions: FontOption[] = customFonts
    .filter((name) => name.trim().length > 0)
    .map((entry) => {
      const clean = extractFontName(entry)
      return {
        id: clean.toLowerCase().replace(/[^a-z0-9]/g, '-'),
        label: clean,
        family: `"${clean}", sans-serif`,
      }
    })
  return [...BASE_FONTS, ...customOptions]
}

export function findMatchingFontOption(fonts: FontOption[], value?: string): FontOption | undefined {
  if (!value) return undefined
  const normalized = value.trim().toLowerCase().replace(/['"]/g, '')
  const primary = normalized.split(',')[0].trim()
  return fonts.find((f) => {
    const fNorm = f.family.toLowerCase().replace(/['"]/g, '')
    const fPrimary = fNorm.split(',')[0].trim()
    return fNorm === normalized || fPrimary === primary || f.id === primary || f.label.toLowerCase() === primary
  })
}
