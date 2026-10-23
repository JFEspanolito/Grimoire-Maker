import { beforeEach, describe, expect, it } from 'vitest'
import { useDocumentStore } from './documentStore'

beforeEach(() => useDocumentStore.getState().resetDocuments())
describe('independent document buffers', () => {
  it('keeps dirty edits when another document becomes active', () => {
    const store = useDocumentStore.getState()
    store.loadFromRaw('/a.md', 'A')
    store.setBody('edited A')
    store.loadFromRaw('/b.md', 'B')
    store.setBody('edited B')
    store.activate('/a.md')
    expect(useDocumentStore.getState().document.body).toBe('edited A')
    expect(useDocumentStore.getState().buffers['/b.md'].body).toBe('edited B')
  })
  it('writes a pane update only into its own document', () => {
    const store = useDocumentStore.getState()
    store.loadFromRaw('/a.md', 'A')
    store.loadFromRaw('/b.md', 'B')
    store.setBodyForPath('/a.md', 'left pane')
    expect(useDocumentStore.getState().document.body).toBe('B')
    expect(useDocumentStore.getState().buffers['/a.md'].body).toBe('left pane')
  })
  it('does not clear edits typed during an asynchronous save', () => {
    const store = useDocumentStore.getState()
    store.loadFromRaw('/a.md', 'A')
    const snapshot = useDocumentStore.getState().document
    store.setBody('newer')
    store.markSnapshotSaved('/a.md', snapshot)
    expect(useDocumentStore.getState().document.dirty).toBe(true)
    expect(useDocumentStore.getState().document.body).toBe('newer')
  })
  it('remaps every open document without losing edits', () => {
    const store = useDocumentStore.getState()
    store.loadFromRaw('/book/a.md', 'A')
    store.setBody('edited')
    store.loadFromRaw('/book/b.md', 'B')
    store.remapDocuments('/book', '/renamed')
    expect(useDocumentStore.getState().buffers['/renamed/a.md'].body).toBe('edited')
    expect(useDocumentStore.getState().document.path).toBe('/renamed/b.md')
  })
})
