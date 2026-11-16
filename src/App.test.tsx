import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import App from './App'
import { useToastStore } from './stores/toastStore'
import { useThemeStore } from './stores/themeStore'
import { useTemplateStore } from './stores/templateStore'
import { DEFAULT_PANELS, useSettingsStore } from './stores/settingsStore'
import { reportError } from './lib/errorLogging'
vi.mock('./lib/errorLogging', () => ({ reportError: vi.fn(), friendlyErrorMessage: (error: unknown) => String(error) }))

it('reports failed library reloads on startup and focus', async () => {
  runtime.native = true
  const themes = useThemeStore.getState().reload
  const templates = useTemplateStore.getState().reload
  const error = new Error('Cannot read themes')
  useThemeStore.setState({ reload: vi.fn(async () => { throw error }) })
  useTemplateStore.setState({ reload: vi.fn(async () => {}) })
  vi.mocked(reportError).mockClear()
  try {
    root = createRoot(document.createElement('div'))
    await act(async () => root?.render(<App />))
    await act(async () => window.dispatchEvent(new Event('focus')))
    expect(reportError).toHaveBeenCalledTimes(2)
    expect(reportError).toHaveBeenCalledWith('library.reload', error)
  } finally {
    runtime.native = false
    await act(async () => root?.unmount()); root = null
    useThemeStore.setState({ reload: themes }); useTemplateStore.setState({ reload: templates })
  }
})

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

it.each(['input', 'textarea', 'editable', 'editor'])('preserves the native editing context menu in %s', async (kind) => {
  runtime.native = false
  const themes = useThemeStore.getState().reload
  const templates = useTemplateStore.getState().reload
  useThemeStore.setState({ reload: vi.fn(async () => {}) })
  useTemplateStore.setState({ reload: vi.fn(async () => {}) })
  const container = document.body.appendChild(document.createElement('div'))
  try {
    root = createRoot(container)
    await act(async () => root?.render(<App />))
    const target = container.appendChild(document.createElement(kind === 'input' || kind === 'textarea' ? kind : 'div'))
    if (kind === 'editable') target.setAttribute('contenteditable', 'true')
    if (kind === 'editor') target.className = 'ProseMirror'
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    await act(async () => target.dispatchEvent(event))
    expect(event.defaultPrevented).toBe(false)
    expect(container.querySelector('[role="menu"]')).toBeNull()
  } finally {
    await act(async () => root?.unmount()); root = null; container.remove()
    useThemeStore.setState({ reload: themes }); useTemplateStore.setState({ reload: templates })
  }
})
beforeAll(() => Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true))
afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = null
  useSettingsStore.setState({ panels: DEFAULT_PANELS })
})

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

it('collapses the right sidebar completely when both snippets and properties are hidden', async () => {
  const container = document.createElement('div')
  root = createRoot(container)
  await act(async () => root?.render(<App />))
  expect(container.querySelector('[data-tour="snippets-sidebar"]')).not.toBeNull()
  expect(container.querySelector('[aria-label="Resize Snippets and Properties panel"]')).not.toBeNull()

  // Hide snippets
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Hide snippets panel"]')!.click())
  // Collapse properties from the sidebar button
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-controls="properties-panel"]')!.click())

  // Right sidebar and resize handle are completely collapsed
  expect(container.querySelector('[data-tour="snippets-sidebar"]')).toBeNull()
  expect(container.querySelector('[aria-label="Resize Snippets and Properties panel"]')).toBeNull()

  // Show snippets again from the View menu
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Show snippets panel"]')!.click())
  expect(container.querySelector('[data-tour="snippets-sidebar"]')).not.toBeNull()
  expect(container.querySelector('[aria-label="Resize Snippets and Properties panel"]')).not.toBeNull()
})
