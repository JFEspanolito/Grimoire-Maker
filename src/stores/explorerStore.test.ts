import { afterEach, expect, it } from 'vitest'
import { importSectionFor, useExplorerStore } from './explorerStore'
import { useTabStore } from './tabStore'

afterEach(() => { useTabStore.getState().reset(null); useExplorerStore.getState().selectPath(null) })
it('uses the selected section before the active file, and clears that choice when tabs change', () => {
  expect(importSectionFor('/book', '/book/Draft/Chapter 1/demo.md', null)).toBe('Draft')
  expect(importSectionFor('/book', '/book/Research/image.png', null)).toBe('Research')
  expect(importSectionFor('/book', '/book/Draft/a.md', '/book/Research')).toBe('Research')
  expect(importSectionFor('/book', '/book/Draft/a.md', '/book/Trash')).toBeNull()
  expect(importSectionFor('/book', null, null)).toBe('Draft')
  expect(importSectionFor('/new', '/new/Research/a.md', '/old/Draft')).toBe('Research')
  useTabStore.getState().reset('/book/Draft/a.md')
  useExplorerStore.getState().selectPath('/book/Research')
  useTabStore.getState().open('/book/Draft/b.md')
  expect(useExplorerStore.getState().selectedPath).toBeNull()
})
