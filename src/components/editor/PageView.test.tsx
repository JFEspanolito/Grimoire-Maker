import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import { PageView } from './PageView'
import { useSettingsStore } from '../../stores/settingsStore'

it('zooms only the editor wrapper while preserving physical page dimensions and content', async () => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  const host = document.createElement('div')
  const root = createRoot(host)
  try {
    useSettingsStore.setState({ zoom: 2, pageSize: 'a4' })
    await act(async () => root.render(<PageView><p>Unchanged text</p></PageView>))
    expect(host.querySelector<HTMLElement>('[data-editor-zoom]')?.style.zoom).toBe('2')
    expect(host.querySelector<HTMLElement>('.grimoire-page')?.style.width).toBe('210mm')
    expect(host.textContent).toBe('Unchanged text')
  } finally {
    await act(async () => root.unmount())
    useSettingsStore.setState({ zoom: 1 })
  }
})
