import { beforeEach, expect, it } from 'vitest'
import { useTabStore } from './tabStore'

beforeEach(() => useTabStore.getState().reset(null))
it('keeps ordinary opens in independent tabs and swaps panes without duplicates', () => {
  const tabs = useTabStore.getState()
  tabs.open('/a.md')
  tabs.open('/b.md')
  tabs.toggleSplit()
  expect(useTabStore.getState().panes).toEqual(['/b.md', '/a.md'])
  tabs.open('/a.md')
  expect(useTabStore.getState().panes).toEqual(['/a.md', '/b.md'])
  tabs.focusPane(1)
  expect(useTabStore.getState().active).toBe('/b.md')
  tabs.toggleSplit()
  expect(useTabStore.getState().panes).toEqual(['/b.md', null])
  expect(useTabStore.getState().paths).toEqual(['/a.md', '/b.md'])
})
it('remaps both panes and keeps an active surviving document on close', () => {
  const tabs = useTabStore.getState()
  tabs.open('/book/a.md')
  tabs.open('/book/b.md')
  tabs.toggleSplit()
  tabs.remap('/book', '/new')
  expect(useTabStore.getState().panes).toEqual(['/new/b.md', '/new/a.md'])
  tabs.remove('/new/a.md')
  expect(useTabStore.getState().active).toBe('/new/b.md')
})
