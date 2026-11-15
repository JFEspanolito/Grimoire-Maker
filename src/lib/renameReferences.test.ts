import { beforeEach, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { renameProjectFile } from './renameReferences'
import type { GrimoireDocument } from '../types/document'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
const before = '[Chapter](old.md)'
const saved: GrimoireDocument = { path: '/book/index.md', body: before, frontmatter: {}, dirty: false }
beforeEach(() => { vi.resetAllMocks() })

it('commits saved bytes while rewriting the newest live buffer without clearing its dirty flag', async () => {
  vi.mocked(invoke).mockResolvedValueOnce({ documents: [{ path: saved.path, before }] }).mockResolvedValueOnce(undefined)
  const transform = await renameProjectFile('/book', '/book/old.md', '/book/new.md')
  expect(invoke).toHaveBeenNthCalledWith(2, 'commit_rename_references', {
    root: '/book', from: '/book/old.md', to: '/book/new.md',
    documents: [{ path: saved.path, before, after: '[Chapter](new.md)' }],
  })
  expect(transform(saved)).toEqual({ ...saved, body: '[Chapter](new.md)' })
  expect(transform({ ...saved, body: `${before}\nNew typing`, dirty: true }))
    .toEqual({ ...saved, body: '[Chapter](new.md)\nNew typing', dirty: true })
  const outside = { ...saved, path: '/other/index.md' }
  expect(transform(outside)).toBe(outside)
  expect(transform({ ...saved, body: `${before}\nExternal change` }).dirty).toBe(true)
})

it('does not expose a successful buffer transform when the disk transaction fails', async () => {
  const failure = new Error('Snapshot changed')
  vi.mocked(invoke).mockResolvedValueOnce({ documents: [{ path: saved.path, before }] }).mockRejectedValueOnce(failure)
  await expect(renameProjectFile('/book', '/book/old.md', '/book/new.md')).rejects.toBe(failure)
  expect(saved.body).toBe(before)
})
