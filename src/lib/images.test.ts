import { beforeEach, expect, it, vi } from 'vitest'
import { importImage, loadImageUrl } from './images'

const mocks = vi.hoisted(() => ({ open: vi.fn(), copyFile: vi.fn(), exists: vi.fn(), mkdir: vi.fn(), readFile: vi.fn() }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mocks.open }))
vi.mock('@tauri-apps/plugin-fs', () => ({ copyFile: mocks.copyFile, exists: mocks.exists, mkdir: mocks.mkdir, readFile: mocks.readFile }))

beforeEach(() => { vi.clearAllMocks(); mocks.exists.mockResolvedValue(false) })

it('loads renamed Markdown image destinations with encoded spaces without changing literal path behavior', async () => {
  mocks.readFile.mockRejectedValueOnce(new Error('Not found')).mockResolvedValueOnce(new Uint8Array([1]))
  const url = await loadImageUrl('../Assets/new%20map.jpg', 'C:/book/Draft/page.md')
  try {
    expect(mocks.readFile).toHaveBeenNthCalledWith(1, 'C:/book/Assets/new%20map.jpg')
    expect(mocks.readFile).toHaveBeenNthCalledWith(2, 'C:/book/Assets/new map.jpg')
  } finally { URL.revokeObjectURL(url) }
  mocks.readFile.mockClear().mockResolvedValueOnce(new Uint8Array([1]))
  const literal = await loadImageUrl('../Assets/literal%20name.jpg', 'C:/book/Draft/page.md')
  try { expect(mocks.readFile).toHaveBeenCalledTimes(1) }
  finally { URL.revokeObjectURL(literal) }
})

it('reuses an image that is already in the project instead of copying it again', async () => {
  mocks.open.mockResolvedValue('C:\\w\\Assets\\Chapter 1\\map.png')
  expect(await importImage('C:/w/Draft/Chapter 2/Scene.md', 'C:\\w')).toBe('../../Assets/Chapter 1/map.png')
  expect(mocks.copyFile).not.toHaveBeenCalled()
})

it('copies an outside image into the mirrored Assets folder and opens the picker on Assets when it exists', async () => {
  mocks.exists.mockImplementation(async (path: string) => path === '/w/Assets')
  mocks.open.mockResolvedValue('/Users/me/Pictures/new map.png')
  expect(await importImage('/w/Draft/Chapter 1/Scene.md', '/w')).toBe('../../Assets/Chapter 1/new-map.png')
  expect(mocks.open).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: '/w/Assets' }))
  expect(mocks.copyFile).toHaveBeenCalledWith('/Users/me/Pictures/new map.png', '/w/Assets/Chapter 1/new-map.png')
})
