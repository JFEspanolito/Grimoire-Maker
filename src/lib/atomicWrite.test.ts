import { beforeEach, describe, expect, it, vi } from 'vitest'
import { rename, writeTextFile } from '@tauri-apps/plugin-fs'
import { savingPath, writeTextFileAtomically } from './atomicWrite'

vi.mock('@tauri-apps/plugin-fs', () => ({ rename: vi.fn(), writeTextFile: vi.fn() }))

beforeEach(() => {
  vi.mocked(writeTextFile).mockReset().mockResolvedValue(undefined)
  vi.mocked(rename).mockReset().mockResolvedValue(undefined)
})

describe('writeTextFileAtomically', () => {
  it('writes a hidden Markdown sibling and renames it over the target', async () => {
    await writeTextFileAtomically('/book/Draft/one.md', 'text')
    expect(savingPath('/book/Draft/one.md')).toBe('/book/Draft/.one.md.saving.md')
    expect(writeTextFile).toHaveBeenCalledExactlyOnceWith('/book/Draft/.one.md.saving.md', 'text')
    expect(rename).toHaveBeenCalledExactlyOnceWith('/book/Draft/.one.md.saving.md', '/book/Draft/one.md')
  })

  it('writes in place when the sibling is refused, as for a document granted without its folder', async () => {
    vi.mocked(writeTextFile).mockRejectedValueOnce(new Error('forbidden path'))
    await writeTextFileAtomically('/home/me/one.md', 'text')
    expect(writeTextFile).toHaveBeenLastCalledWith('/home/me/one.md', 'text')
    expect(writeTextFile).toHaveBeenCalledTimes(2)
    expect(rename).not.toHaveBeenCalled()
  })

  it('reports the error when both the sibling and the in-place write fail', async () => {
    vi.mocked(writeTextFile).mockRejectedValueOnce(new Error('disk full')).mockRejectedValueOnce(new Error('disk full'))
    await expect(writeTextFileAtomically('/book/one.md', 'text')).rejects.toThrow('disk full')
    expect(rename).not.toHaveBeenCalled()
  })

  it('reports a failed rename and leaves the target untouched', async () => {
    vi.mocked(rename).mockRejectedValueOnce(new Error('locked'))
    await expect(writeTextFileAtomically('/book/one.md', 'text')).rejects.toThrow('locked')
    expect(writeTextFile).toHaveBeenCalledExactlyOnceWith('/book/.one.md.saving.md', 'text')
  })
})
