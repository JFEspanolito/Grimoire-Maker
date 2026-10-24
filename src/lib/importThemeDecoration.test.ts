import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { importThemeDecoration } from './importThemeDecoration'

const mocks = vi.hoisted(() => ({ open: vi.fn(), stat: vi.fn(), readFile: vi.fn() }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mocks.open }))
vi.mock('@tauri-apps/plugin-fs', () => ({ stat: mocks.stat, readFile: mocks.readFile }))
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM/8AAAAASUVORK5CYII='
beforeEach(() => { vi.resetAllMocks(); mocks.open.mockResolvedValue('/flowers.png'); mocks.stat.mockResolvedValue({ size: 100 }) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('cancels without reads and rejects oversized or disguised SVG files before decoding', async () => {
  mocks.open.mockResolvedValueOnce(null)
  expect(await importThemeDecoration()).toBeNull()
  expect(mocks.stat).not.toHaveBeenCalled()
  mocks.stat.mockResolvedValueOnce({ size: 11 * 1024 * 1024 })
  await expect(importThemeDecoration()).rejects.toThrow('10 MB')
  expect(mocks.readFile).not.toHaveBeenCalled()
  mocks.readFile.mockResolvedValue(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))
  const decode = vi.fn(); vi.stubGlobal('createImageBitmap', decode)
  await expect(importThemeDecoration()).rejects.toThrow('SVG')
  expect(decode).not.toHaveBeenCalled()
})
it('embeds normalized PNG data and releases decoded pixels without copying project assets', async () => {
  mocks.readFile.mockResolvedValue(Uint8Array.from(atob(png.split(',')[1]), char => char.charCodeAt(0)))
  const bitmap = { width: 80, height: 40, close: vi.fn() }
  vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap))
  const draw = vi.fn()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: draw } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(png)
  const item = await importThemeDecoration()
  expect(item).toMatchObject({ name: 'flowers.png', dataUrl: png, widthMm: 40, heightMm: 20, anchor: 'header' })
  expect(draw).toHaveBeenCalledOnce()
  expect(bitmap.close).toHaveBeenCalledOnce()
})
