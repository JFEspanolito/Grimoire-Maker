import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MarkdownSourceView } from './MarkdownSourceView'
import { useDocumentStore } from '../../stores/documentStore'
import { emitPluginEvent } from '../../plugins/plugin-manager'

vi.mock('../../plugins/plugin-manager', () => ({ emitPluginEvent: vi.fn() }))
let root: Root
let host: HTMLDivElement
beforeEach(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  vi.clearAllMocks()
  useDocumentStore.getState().resetDocuments()
  useDocumentStore.getState().loadFromRaw('/book/a.md', '# A')
  useDocumentStore.getState().loadFromRaw('/book/b.md', '# B')
  host = document.createElement('div'); document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  useDocumentStore.getState().endRestore()
  await act(async () => root.unmount())
  host.remove()
})
async function input(textarea: HTMLTextAreaElement, raw: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, raw)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

it('makes only affected source editors read-only and ignores local edits during restore', async () => {
  await act(async () => root.render(<><MarkdownSourceView path="/book/a.md" /><MarkdownSourceView path="/book/b.md" /></>))
  const [affected, other] = Array.from(host.querySelectorAll('textarea'))
  await act(async () => useDocumentStore.getState().beginRestore(['/book/a.md']))
  expect(affected.readOnly).toBe(true)
  expect(other.readOnly).toBe(false)
  await input(affected, '# Ignored during restore')
  expect(useDocumentStore.getState().buffers['/book/a.md']).toMatchObject({ body: '# A', dirty: false })
  expect(affected.value).toBe('# A')
  expect(emitPluginEvent).not.toHaveBeenCalled()
  await input(other, '# Unrelated edit')
  expect(useDocumentStore.getState().buffers['/book/b.md']).toMatchObject({ body: '# Unrelated edit', dirty: true })
  expect(emitPluginEvent).toHaveBeenCalledTimes(1)
  await act(async () => {
    useDocumentStore.getState().restoreFromDisk('/book/a.md', '# Restored')
    useDocumentStore.getState().endRestore()
  })
  expect(affected.readOnly).toBe(false)
  expect(affected.value).toBe('# Restored')
  await input(affected, '# Fresh edit')
  expect(useDocumentStore.getState().buffers['/book/a.md']).toMatchObject({ body: '# Fresh edit', dirty: true })
})
