import { beforeEach, expect, it, vi } from 'vitest'
import { importImage } from './images'

const mocks = vi.hoisted(() => ({ open: vi.fn(), copyFile: vi.fn(), exists: vi.fn(), mkdir: vi.fn(), readFile: vi.fn() }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mocks.open }))
vi.mock('@tauri-apps/plugin-fs', () => ({ copyFile: mocks.copyFile, exists: mocks.exists, mkdir: mocks.mkdir, readFile: mocks.readFile }))

beforeEach(() => { vi.clearAllMocks(); mocks.exists.mockResolvedValue(false) })

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
