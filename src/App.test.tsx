import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import App from './App'

vi.mock('./hooks/useFileSystem', () => ({
  isTauri: () => false,
  useFileSystem: () => ({ restoreSession: vi.fn() }),
}))
vi.mock('./components/layout/Toolbar', () => ({ Toolbar: () => null }))
vi.mock('./components/sidebar/FileTree', () => ({ FileTree: () => <div>Files panel</div> }))
vi.mock('./components/templates/TemplateCatalog', () => ({ TemplateCatalog: () => <div>Templates panel</div> }))
vi.mock('./components/snippets/SnippetPalette', () => ({ SnippetPalette: () => <div>Snippets panel</div> }))
vi.mock('./components/layout/DocumentTabs', () => ({ DocumentTabs: () => null }))
vi.mock('./components/editor/EditorCanvas', () => ({ EditorCanvas: () => null }))
vi.mock('./components/editor/EditorToolbar', () => ({ EditorToolbar: () => null }))
vi.mock('./components/editor/PagePreview', () => ({ PagePreview: () => null }))
vi.mock('./components/version-control/VersionControlPanel', () => ({ VersionControlPanel: () => <div>Git controls</div> }))
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
    await act(async () => container.querySelector<HTMLButtonElement>(`[aria-label="Hide ${panel} panel"]`)?.click())
    expect(container.textContent).not.toContain(`${panel[0].toUpperCase()}${panel.slice(1)} panel`)
    await act(async () => container.querySelector<HTMLButtonElement>(`[aria-label="Show ${panel} panel"]`)?.click())
    expect(container.textContent).toContain(`${panel[0].toUpperCase()}${panel.slice(1)} panel`)
  }
})

it('opens source control from the lower-left Git control', async () => {
  const container = document.createElement('div')
  root = createRoot(container)
  await act(async () => root?.render(<App />))
  expect(container.textContent).not.toContain('Git controls')
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-controls="source-control-panel"]')?.click())
  expect(container.textContent).toContain('Git controls')
})
