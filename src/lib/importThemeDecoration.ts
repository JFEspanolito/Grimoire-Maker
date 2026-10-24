import { MAX_DECORATION_BYTES, validateDecorations, type ThemeDecoration } from './themeDecorations'

export async function importThemeDecoration(): Promise<ThemeDecoration | null> {
  const { open } = await import('@tauri-apps/plugin-dialog')
  const { stat, readFile } = await import('@tauri-apps/plugin-fs')
  const path = await open({ title: 'Import background image', multiple: false, filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] })
  if (!path || Array.isArray(path)) return null
  if ((await stat(path)).size > 10 * 1024 * 1024) throw new Error('Choose an image smaller than 10 MB.')
  const bytes = await readFile(path)
  if (bytes.byteLength > 10 * 1024 * 1024) throw new Error('Choose an image smaller than 10 MB.')
  const header = Array.from(bytes.slice(0, 12), byte => String.fromCharCode(byte)).join('')
  if (!(header.startsWith('\x89PNG\r\n\x1a\n') || header.startsWith('\xff\xd8\xff') || (header.startsWith('RIFF') && header.slice(8) === 'WEBP'))) {
    throw new Error('Choose a valid PNG, JPEG or WebP image. SVG is not supported for theme backgrounds.')
  }
  const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)]))
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 16_000_000) throw new Error('Choose an image with at most 16 megapixels.')
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Image processing is unavailable.')
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const dataUrl = canvas.toDataURL('image/png')
    if (dataUrl.length > MAX_DECORATION_BYTES * 4 / 3) throw new Error('The processed image exceeds 2 MB. Use a smaller image.')
    const widthMm = Math.min(40, 60 * canvas.width / canvas.height)
    return validateDecorations([{ id: crypto.randomUUID(), name: path.split(/[\\/]/).pop()!.slice(0, 120), dataUrl,
      widthMm, heightMm: widthMm * canvas.height / canvas.width, xMm: 5, yMm: 5, anchor: 'header' }])[0]
  } finally { bitmap.close() }
}
