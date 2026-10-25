import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { DocumentIndex } from './DocumentIndex'
import { useDocumentStore } from '../../stores/documentStore'
import { useSettingsStore } from '../../stores/settingsStore'

afterEach(() => { useSettingsStore.getState().setShowDocumentIndex(true); useDocumentStore.getState().resetDocuments() })

async function mount() {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 0 })
  const container = document.createElement('div')
  const root = createRoot(container)
  await act(async () => root.render(<section>
    <DocumentIndex path={null} visible />
    <div className="ProseMirror"><h1>First H1</h1><h2>First H2</h2><h3>First H3</h3><p>text</p><h1>Second H1</h1><h4>Ignored</h4></div>
  </section>))
  const pane = container
  return { pane, unmount: () => act(async () => root.unmount()) }
}

it('lists H1-H3 headings of the document, indented by level, and scrolls to the clicked one', async () => {
  const { pane, unmount } = await mount()
  const scroll = vi.fn()
  pane.querySelector('.ProseMirror h2')!.scrollIntoView = scroll
  const items = Array.from(pane.querySelectorAll('nav li'))
  expect(items.map((item) => [item.getAttribute('data-level'), item.textContent])).toEqual([
    ['1', 'First H11'], ['2', 'First H21'], ['3', 'First H31'], ['1', 'Second H11'],
  ])
  expect(pane.querySelector('nav h2')!.textContent).toBe('Untitled Grimoire')
  await act(async () => items[1].querySelector('button')!.click())
  expect(scroll).toHaveBeenCalledOnce()
  await unmount()
})

it('is hidden when Document Index is turned off', async () => {
  useSettingsStore.getState().setShowDocumentIndex(false)
  const { pane, unmount } = await mount()
  expect(pane.querySelector('nav')).toBeNull()
  await unmount()
})
