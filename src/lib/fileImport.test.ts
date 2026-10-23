import { describe, expect, it, vi } from 'vitest'
import { importFiles } from './fileImport'

describe('binder imports', () => {
  const fs = () => ({ exists: vi.fn(async () => false), stat: vi.fn(async () => ({ size: 3, isFile: true })), readFile: vi.fn(async () => new Uint8Array([0, 255, 1])), writeFile: vi.fn(async () => {}) })
  it.each(['Draft', 'Research'] as const)('copies binary files into %s without overwriting', async (section) => {
    const io = fs()
    io.exists.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    const result = await importFiles('/book', section, ['C:\\images\\map.png'], io)
    expect(result).toEqual([`/book/${section}/map-1.png`])
    expect(io.writeFile).toHaveBeenCalledWith(`/book/${section}/map-1.png`, new Uint8Array([0, 255, 1]), { createNew: true })
  })
  it('does not write directories or oversized files', async () => {
    const io = fs()
    io.stat.mockResolvedValue({ size: 100 * 1024 * 1024, isFile: true })
    await expect(importFiles('/book', 'Draft', ['/huge.zip'], io)).rejects.toThrow('64 MiB')
    expect(io.writeFile).not.toHaveBeenCalled()
  })
  it('reports failed exclusive creation rather than overwriting a raced destination', async () => {
    const io = fs()
    io.writeFile.mockRejectedValue(new Error('already exists'))
    await expect(importFiles('/book', 'Research', ['/map.png'], io)).rejects.toThrow('already exists')
    expect(io.writeFile).toHaveBeenCalledTimes(1)
  })
})
