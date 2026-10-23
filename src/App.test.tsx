import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import App from './App'

vi.mock('./hooks/useFileSystem', () => ({
  isTauri: () => false,
  useFileSystem: () => ({ restoreSession: vi.fn() }),
}))
vi.mock('./components/layout/Toolbar', () => ({
  Toolbar: ({ visiblePanels, onTogglePanel }: {
    visiblePanels: Record<'files' | 'templates' | 'snippets', boolean>
    onTogglePanel: (panel: 'files' | 'templates' | 'snippets') => void
  }) => <div>{(['files', 'templates', 'snippets'] as const).map((panel) => (
    <button key={panel} onClick={() => onTogglePanel(panel)}>{visiblePanels[panel] ? `Hide ${panel}` : `Show ${panel}`}</button>
  ))}</div>,
}))
vi.mock('./components/sidebar/FileTree', () => ({ FileTree: () => <div>Files panel</div> }))
vi.mock('./components/templates/TemplateCatalog', () => ({ TemplateCatalog: () => <div>Templates panel</div> }))
vi.mock('./components/snippets/SnippetPalette', () => ({ SnippetPalette: () => <div>Snippets panel</div> }))
vi.mock('./components/layout/DocumentTabs', () => ({ DocumentTabs: () => null }))
vi.mock('./components/editor/EditorCanvas', () => ({ EditorCanvas: () => null }))
vi.mock('./components/editor/EditorToolbar', () => ({ EditorToolbar: () => null }))
vi.mock('./components/editor/PagePreview', () => ({ PagePreview: () => null }))
vi.mock('./plugins/PluginContext', () => ({ PluginProvider: ({ children }: { children: React.ReactNode }) => children }))

let root: Root | null = null
beforeAll(() => Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true))
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = null })

it('hides each horizontal panel independently and restores it', async () => {
  const container = document.createElement('div')
  root = createRoot(container)
  await act(async () => root?.render(<App />))

  for (const panel of ['files', 'templates', 'snippets']) {
    expect(container.textContent).toContain(`${panel[0].toUpperCase()}${panel.slice(1)} panel`)
    await act(async () => Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === `Hide ${panel}`)?.click())
    expect(container.textContent).not.toContain(`${panel[0].toUpperCase()}${panel.slice(1)} panel`)
    await act(async () => Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === `Show ${panel}`)?.click())
    expect(container.textContent).toContain(`${panel[0].toUpperCase()}${panel.slice(1)} panel`)
  }
})
