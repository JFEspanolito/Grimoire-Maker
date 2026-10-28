import { expect, it, vi } from 'vitest'
import { save } from '@tauri-apps/plugin-dialog'
import { writeFile } from '@tauri-apps/plugin-fs'
import { strFromU8 } from 'fflate'
import { OFFICIAL_TEMPLATES } from './templates'
import { readTemplateZip } from './templatePackage'
import { exportTemplateZip } from './templateActions'

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }))
vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn(), mkdir: vi.fn(), readDir: vi.fn(), readFile: vi.fn(), stat: vi.fn(), writeFile: vi.fn(),
  rename: vi.fn(), remove: vi.fn(),
  readTextFile: vi.fn(),
}))

it('exports an official preset as a usable zip package', async () => {
  vi.mocked(save).mockResolvedValue('C:/exports/poetry-collection.zip')
  vi.mocked(writeFile).mockResolvedValue(undefined)

  expect(await exportTemplateZip(OFFICIAL_TEMPLATES[0])).toBe(true)

  const [path, bytes] = vi.mocked(writeFile).mock.calls[0]
  expect(path).toBe('C:/exports/poetry-collection.zip')
  const files = readTemplateZip(bytes as Uint8Array)
  expect(strFromU8(files['index.md'])).toContain('title: Untitled Poetry Collection')
})
