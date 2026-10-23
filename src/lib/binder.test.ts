import { describe, expect, it } from 'vitest'
import type { FileNode } from '../types/document'
import { BINDER_FOLDERS, remapPath, setupBinder, splitBinder, type BinderFs } from './binder'

const file = (path: string): FileNode => ({ name: path.split('/').pop()!, path, isDirectory: false })
const folder = (path: string, children: FileNode[] = []): FileNode => ({
  name: path.split('/').pop()!,
  path,
  isDirectory: true,
  children,
})

describe('splitBinder', () => {
  it('returns null for an ordinary folder with none of the binder sections', () => {
    expect(splitBinder([file('/w/a.md'), folder('/w/notes')])).toBeNull()
  })

  it('separates Draft, Research and Trash from everything else', () => {
    const tree = [
      folder('/w/Draft', [file('/w/Draft/ch1.md')]),
      folder('/w/Research'),
      folder('/w/Trash', [file('/w/Trash/old.md')]),
      file('/w/loose.md'),
      folder('/w/assets'),
    ]
    const view = splitBinder(tree)!
    expect(view.draft?.children?.map((c) => c.name)).toEqual(['ch1.md'])
    expect(view.research?.path).toBe('/w/Research')
    expect(view.trash?.children).toHaveLength(1)
    expect(view.other.map((n) => n.name)).toEqual(['loose.md', 'assets'])
  })

  it('is enough to have one of the sections', () => {
    const view = splitBinder([folder('/w/Draft')])!
    expect(view.draft).not.toBeNull()
    expect(view.research).toBeNull()
    expect(view.trash).toBeNull()
  })

  it('matches section names regardless of letter case, as the filesystem does on Windows', () => {
    expect(splitBinder([folder('/w/draft')])?.draft?.path).toBe('/w/draft')
  })

  it('ignores a file that merely has a section name', () => {
    expect(splitBinder([file('/w/Draft')])).toBeNull()
  })
})

describe('setupBinder', () => {
  function fakeFs(existing: string[] = []): BinderFs & { created: string[] } {
    const have = new Set(existing)
    const created: string[] = []
    return {
      created,
      exists: async (p) => have.has(p),
      mkdir: async (p) => {
        have.add(p)
        created.push(p)
      },
    }
  }

  it('creates the three folders in a fresh workspace', async () => {
    const fs = fakeFs()
    expect(await setupBinder(fs, '/w')).toEqual(['Draft', 'Research', 'Trash'])
    expect(fs.created).toEqual(['/w/Draft', '/w/Research', '/w/Trash'])
  })

  it('only creates what is missing and never touches existing folders', async () => {
    const fs = fakeFs(['/w/Draft'])
    expect(await setupBinder(fs, '/w')).toEqual(['Research', 'Trash'])
    expect(fs.created).not.toContain('/w/Draft')
  })

  it('does nothing when the binder is already complete', async () => {
    const fs = fakeFs(BINDER_FOLDERS.map((f) => `/w/${f}`))
    expect(await setupBinder(fs, '/w')).toEqual([])
    expect(fs.created).toEqual([])
  })
})

describe('remapPath', () => {
  it('follows a moved file', () => {
    expect(remapPath('/w/a.md', '/w/a.md', '/w/Draft/a.md')).toBe('/w/Draft/a.md')
  })

  it('follows a file inside a moved folder', () => {
    expect(remapPath('/w/ch/one.md', '/w/ch', '/w/Draft/ch')).toBe('/w/Draft/ch/one.md')
  })

  it('leaves unrelated paths and a null path alone', () => {
    expect(remapPath('/w/other.md', '/w/a.md', '/w/b.md')).toBe('/w/other.md')
    expect(remapPath(null, '/w/a.md', '/w/b.md')).toBeNull()
  })

  it('does not treat a sibling with a shared prefix as inside the folder', () => {
    expect(remapPath('/w/chapters-extra/x.md', '/w/chapters', '/w/Draft/chapters')).toBe('/w/chapters-extra/x.md')
  })
})
