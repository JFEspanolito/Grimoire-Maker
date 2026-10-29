import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import App from './App'
import { useToastStore } from './stores/toastStore'
import { useThemeStore } from './stores/themeStore'
import { useTemplateStore } from './stores/templateStore'

const runtime = vi.hoisted(() => ({ native: false, restore: vi.fn(async () => {}), startExternal: vi.fn(async () => {}) }))
vi.mock('./plugins/isolated/externalHost', () => ({ startActiveExternalPlugins: runtime.startExternal }))
vi.mock('./lib/appState', () => ({ watchSettings: () => () => {} }))
vi.mock('./hooks/useAutoSave', () => ({ useAutoSave: () => {} }))
vi.mock('./hooks/useAutoCommit', () => ({ useAutoCommit: () => {} }))
vi.mock('./hooks/useUnsavedClose', () => ({ useUnsavedClose: () => {} }))

vi.mock('./hooks/useRepositoryStatus', () => ({ useRepositoryStatus: () => ({ status: { isRepository: true, entries: [{}, {}] }, error: '' }) }))
vi.mock('./hooks/useFileSystem', () => ({
  isTauri: () => runtime.native,
  useFileSystem: () => ({ restoreSession: runtime.restore }),
}))
vi.mock('./components/layout/Toolbar', () => ({ Toolbar: () => null }))
vi.mock('./components/project/NewProjectDialog', () => ({ NewProjectDialog: () => null }))
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

it('does not activate previously imported plugins at desktop startup', async () => {
  runtime.native = true
  const themes = useThemeStore.getState().reload
  const templates = useTemplateStore.getState().reload
  useThemeStore.setState({ reload: vi.fn(async () => {}) })
  useTemplateStore.setState({ reload: vi.fn(async () => {}) })
  try {
    root = createRoot(document.createElement('div'))
    await act(async () => root?.render(<App />))
    expect(runtime.restore).toHaveBeenCalled()
    expect(runtime.startExternal).not.toHaveBeenCalled()
  } finally {
    await act(async () => root?.unmount())
    root = null
    runtime.native = false
    useThemeStore.setState({ reload: themes })
    useTemplateStore.setState({ reload: templates })
  }
})

it.each([
  ['project-sidebar', 'Resize Files panel', 224, 1],
  ['snippets-sidebar', 'Resize Snippets and Properties panel', 256, -1],
] as const)('resizes %s independently with pointer and keyboard', async (panel, label, initial, direction) => {
  const container = document.createElement('div')
  root = createRoot(container)
  await act(async () => root?.render(<App />))
  const aside = container.querySelector<HTMLElement>(`[data-tour="${panel}"]`)!
  const handle = container.querySelector<HTMLElement>(`[aria-label="${label}"]`)
  expect(handle).not.toBeNull()
  const pointer = (type: string, x: number) => {
    const event = new MouseEvent(type, { bubbles: true, clientX: x, button: 0 })
    Object.defineProperty(event, 'pointerId', { value: 1 })
    handle!.dispatchEvent(event)
  }
  await act(async () => pointer('pointerdown', 400))
  await act(async () => pointer('pointermove', 400 + direction * 40))
  await act(async () => pointer('pointerup', 400 + direction * 40))
  expect(aside.style.width).toBe(`${initial + 40}px`)
  await act(async () => handle!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: direction === 1 ? 'ArrowLeft' : 'ArrowRight' })))
  expect(aside.style.width).toBe(`${initial + 30}px`)
  await act(async () => handle!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Home' })))
  expect(aside.style.width).toBe('160px')
  expect(container.querySelector<HTMLElement>(`[data-tour="${direction === 1 ? 'snippets-sidebar' : 'project-sidebar'}"]`)!.style.width).toBe(`${direction === 1 ? 256 : 224}px`)
})

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

it('starts source control expanded and allows collapsing and reopening it', async () => {
  const container = document.createElement('div')
  root = createRoot(container)
  await act(async () => root?.render(<App />))
  expect(container.textContent).toContain('Git controls')
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-controls="source-control-panel"]')?.click())
  expect(container.textContent).not.toContain('Git controls')
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-controls="source-control-panel"]')?.click())
  expect(container.textContent).toContain('Git controls')
})

it('keeps the uncommitted marker visible while source control is collapsed', async () => {
  const container = document.createElement('div')
  root = createRoot(container)
  await act(async () => root?.render(<App />))
  const button = container.querySelector<HTMLButtonElement>('[aria-controls="source-control-panel"]')!
  expect(button.getAttribute('aria-expanded')).toBe('true')
  await act(async () => button.click())
  expect(button.getAttribute('aria-expanded')).toBe('false')
  expect(button.querySelector('[aria-label="2 uncommitted changes"]')).not.toBeNull()
})

it('opens Properties below Snippets and keeps it available when Snippets is hidden', async () => {
  const container = document.createElement('div')
  root = createRoot(container)
  await act(async () => root?.render(<App />))
  const toggle = container.querySelector<HTMLButtonElement>('[aria-controls="properties-panel"]')
  expect(toggle).not.toBeNull()
  expect(toggle!.getAttribute('aria-expanded')).toBe('true')
  expect(container.textContent).toContain('Project properties')
  expect(container.textContent).toContain('Page properties')
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Hide snippets panel"]')!.click())
  expect(container.querySelector('#properties-panel')).not.toBeNull()
})

it('offers Export Page Content as Snippet in the properties panel and hosts toasts', async () => {
  const container = document.createElement('div')
  root = createRoot(container)
  await act(async () => root?.render(<App />))
  const properties = container.querySelector('#properties-panel')!
  expect(Array.from(properties.querySelectorAll('button')).some((button) => button.textContent === 'Export Page Content as Snippet')).toBe(true)
  expect(container.querySelector('[role="status"]')).toBeNull()
  await act(async () => { useToastStore.getState().show('Snippet añadido a la paleta lateral', 0) })
  expect(container.querySelector('[role="status"]')?.textContent).toBe('Snippet añadido a la paleta lateral')
  await act(async () => useToastStore.setState({ toasts: [] }))
})
