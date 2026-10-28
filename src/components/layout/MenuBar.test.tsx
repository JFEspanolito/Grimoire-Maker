import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TableExtensions } from '../editor/extensions/tables'
import { GrimoireImage } from '../editor/extensions/image'
import { importImage } from '../../lib/images'
import { useDocumentStore } from '../../stores/documentStore'
import { MenuBar } from './MenuBar'
import { Toolbar } from './Toolbar'
import { EditorToolbar } from '../editor/EditorToolbar'
import { useSessionStore } from '../../stores/sessionStore'
import { useTabStore } from '../../stores/tabStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useFindStore } from '../../stores/findStore'
import zoomPlugin from '../../assets/mods/Legacy/zoom/zoom'
import { registerPlugin } from '../../plugins/plugin-manager'

const openWorkspace = vi.hoisted(() => vi.fn())
const openRecent = vi.hoisted(() => vi.fn())
const saveFile = vi.hoisted(() => vi.fn())
const saveAll = vi.hoisted(() => vi.fn())
const openFile = vi.hoisted(() => vi.fn())
const createNewFile = vi.hoisted(() => vi.fn())
const createProject = vi.hoisted(() => vi.fn())
const refreshTree = vi.hoisted(() => vi.fn())
vi.mock('../../hooks/useFileSystem', () => ({ useFileSystem: () => ({ openWorkspace, openRecent, saveFile, saveAll, openFile, createNewFile, createProject, refreshTree }), isTauri: () => false }))
vi.mock('../../lib/images', () => ({ importImage: vi.fn() }))
vi.mock('../../hooks/usePrint', () => ({ usePrint: () => vi.fn() }))
vi.mock('../../lib/modExport', () => ({ exportTheme: vi.fn(), exportSnippet: vi.fn(), exportSnippetPack: vi.fn(), exportProjectAsTemplate: vi.fn() }))
vi.mock('../../lib/snippetLibrary', () => ({ saveSnippetToLibrary: vi.fn() }))
vi.mock('../settings/PreferencesDialog', async () => {
  const { createElement } = await import('react')
  return { PreferencesDialog: (props: { initialCustomizing?: boolean }) => createElement('div', { 'data-testid': 'preferences', 'data-customizing': String(!!props.initialCustomizing) }) }
})

it('groups application actions in keyboard-accessible menus', async () => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  const container = document.createElement('div')
  const root = createRoot(container)
  const toggle = vi.fn()
  await act(async () => root.render(<MenuBar visiblePanels={{ files: true, templates: true, snippets: true, git: true, properties: true }} onTogglePanel={toggle} />))
  expect(Array.from(container.querySelectorAll('nav > details > summary')).map((item) => item.textContent)).toEqual(['File', 'View', 'Insert', 'Document', 'Settings'])
  await act(async () => Array.from(container.querySelectorAll('button')).find((item) => item.textContent === 'Open Folder…')?.click())
  expect(openWorkspace).toHaveBeenCalledOnce()
  expect(container.textContent).not.toContain('Pack ZIP')
  expect(container.textContent).not.toContain('Restore ZIP')
  await act(async () => Array.from(container.querySelectorAll('button')).find((item) => item.textContent === 'Save')?.click())
  expect(saveFile).toHaveBeenCalledOnce()
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Hide files panel"]')?.click())
  expect(toggle).toHaveBeenCalledWith('files')
  await act(async () => root.unmount())
})

it('has reversible marked view actions and no duplicated toolbar commands', async () => {
  const unloadZoom = registerPlugin(zoomPlugin)
  useTabStore.getState().reset('/chapter.md')
  useSettingsStore.getState().setViewMode('edit')
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    await act(async () => root.render(<><MenuBar visiblePanels={{ files: true, templates: true, snippets: true, git: true, properties: true }} onTogglePanel={() => {}} /><Toolbar /><EditorToolbar editor={null} /></>))
    const view = Array.from(container.querySelectorAll('details')).find((menu) => menu.querySelector('summary')?.textContent === 'View')!
    const split = view.querySelector<HTMLButtonElement>('[aria-label="Split View"]')!
    expect(split?.getAttribute('aria-pressed')).toBe('false')
    await act(async () => split.click())
    expect(split.getAttribute('aria-pressed')).toBe('true')
    expect(split.textContent).toContain('✓')
    expect(view.querySelector('[aria-label="Page View"]')).toBeNull()
    expect(view.querySelector('[aria-label="Preview layout"]')).toBeNull()
    const layout = container.querySelector<HTMLSelectElement>('[aria-label="Page view"]')!
    expect(Array.from(layout.options).map(option => option.value)).toEqual(['edit', 'spreads'])
    layout.value = 'spreads'
    await act(async () => layout.dispatchEvent(new Event('change', { bubbles: true })))
    expect(useSettingsStore.getState().viewMode).toBe('spreads')
    const zoom = container.querySelector<HTMLSelectElement>('[aria-label="Editor zoom"]')!
    expect(zoom.disabled).toBe(false)
    expect(Array.from(zoom.options).map(option => option.value)).toContain('3')
    expect(Array.from(zoom.options).map(option => option.value)).toContain('0.25')
    const toolbar = container.querySelector('header')!
    for (const label of ['Open', 'Save', 'Import', 'Export PDF', 'Files', 'Templates', 'Snippets', 'Split View']) {
      expect(Array.from(toolbar.querySelectorAll('button')).some((button) => button.textContent?.trim() === label)).toBe(false)
    }
    expect(toolbar.querySelector('[aria-label="Theme"]')).toBeNull()
    expect(toolbar.querySelector('[aria-label="View"]')).toBeNull()
    const settings = Array.from(container.querySelectorAll('details')).find((menu) => menu.querySelector('summary')?.textContent === 'Settings')!
    expect(settings.textContent).toContain('Mod Manager')
    expect(settings.textContent).toContain('Preferences…')
  } finally {
    await act(async () => root.unmount())
    unloadZoom()
    useTabStore.getState().reset(null)
    useSettingsStore.getState().setViewMode('edit')
  }
})

it('makes file creation and opening folders discoverable in File', async () => {
  const container = document.createElement('div')
  const root = createRoot(container)
  await act(async () => root.render(<MenuBar visiblePanels={{ files: true, templates: true, snippets: true, git: true, properties: true }} onTogglePanel={() => {}} />))
  const buttons = Array.from(container.querySelector('details')!.querySelectorAll('button'))
  expect(buttons.slice(0, 4).map((button) => button.textContent)).toEqual(['New File…', 'New Project…', 'Open File…', 'Open Folder…'])
  await act(async () => buttons[0].click())
  expect(createNewFile).toHaveBeenCalledOnce()
  openWorkspace.mockClear()
  await act(async () => buttons[3].click())
  expect(openWorkspace).toHaveBeenCalledOnce()
  await act(async () => root.unmount())
})

it('keeps page setup only in Document and omits repeated application branding', async () => {
  const initial = useSettingsStore.getState()
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    await act(async () => root.render(<><MenuBar visiblePanels={{ files: true, templates: true, snippets: true, git: true, properties: true }} onTogglePanel={() => {}} /><Toolbar /><EditorToolbar editor={null} /></>))
    const nav = container.querySelector('nav')!
    const menus = Array.from(nav.querySelectorAll('details'))
    const view = menus.find((menu) => menu.querySelector('summary')?.textContent === 'View')!
    const documentMenu = menus.find((menu) => menu.querySelector('summary')?.textContent === 'Document')!
    expect(view.querySelector('[aria-label="Page size"]')).toBeNull()
    expect(view.querySelector('[aria-label="Columns"]')).toBeNull()
    const size = documentMenu.querySelector<HTMLSelectElement>('[aria-label="Page size"]')
    const columns = documentMenu.querySelector<HTMLSelectElement>('[aria-label="Columns"]')
    expect(size).not.toBeNull()
    expect(columns).not.toBeNull()
    expect(container.querySelector('header [aria-label="Page size"]')).toBeNull()
    expect(container.querySelector('header [aria-label="Columns"]')).toBeNull()
    expect(nav.querySelector('img')).toBeNull()
    expect(nav.textContent).not.toContain('GRIMOIRE MAKER')
    await act(async () => { size!.value = 'letter'; size!.dispatchEvent(new Event('change', { bubbles: true })) })
    await act(async () => { columns!.value = '1'; columns!.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(useSettingsStore.getState()).toMatchObject({ pageSize: 'letter', columns: 1 })
    for (const entry of ['Properties…', 'Document Order…', 'Statistics…', 'Export PDF…']) expect(documentMenu.textContent).toContain(entry)
  } finally {
    await act(async () => root.unmount())
    useSettingsStore.setState({ pageSize: initial.pageSize, columns: initial.columns })
  }
})

it('keeps the new project dialog open on picker cancellation or error and closes after creation', async () => {
  const showModal = vi.fn()
  const originalShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal')
  const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close')
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: showModal })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: vi.fn() })
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    await act(async () => root.render(<MenuBar visiblePanels={{ files: true, templates: true, snippets: true, git: true, properties: true }} onTogglePanel={() => {}} />))
    await act(async () => Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'New Project…')?.click())
    expect(showModal).toHaveBeenCalledOnce()
    expect(container.querySelector('dialog')?.textContent).toContain('Choose Location & Create')
    const submit = async () => act(async () => { container.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    createProject.mockResolvedValueOnce(false)
    await submit()
    expect(createProject).toHaveBeenCalledWith('My Grimoire')
    expect(container.querySelector('dialog')).not.toBeNull()
    createProject.mockRejectedValueOnce(new Error('Folder already exists'))
    await submit()
    expect(container.querySelector('dialog [role="alert"]')?.textContent).toBe('Folder already exists')
    createProject.mockResolvedValueOnce(true)
    await submit()
    expect(container.querySelector('dialog')).toBeNull()
  } finally {
    await act(async () => root.unmount())
    if (originalShow) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', originalShow)
    else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
    if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, 'close', originalClose)
    else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close')
  }
})

it('runs basic file shortcuts through the existing actions without stealing modal or editor keys', async () => {
  const container = document.createElement('div')
  const root = createRoot(container)
  const modal = document.createElement('dialog')
  const press = async (key: string, modifiers: KeyboardEventInit = { ctrlKey: true }) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers })
    await act(async () => window.dispatchEvent(event))
    return event
  }
  try {
    saveAll.mockClear(); openFile.mockClear(); createNewFile.mockClear()
    await act(async () => root.render(<MenuBar visiblePanels={{ files: true, templates: true, snippets: true, git: true, properties: true }} onTogglePanel={() => {}} />))
    expect((await press('s')).defaultPrevented).toBe(true)
    expect(saveAll).toHaveBeenCalledOnce()
    await press('s', { ctrlKey: true, repeat: true })
    expect(saveAll).toHaveBeenCalledOnce()
    await press('o')
    await press('n')
    expect(openFile).toHaveBeenCalledOnce()
    expect(createNewFile).toHaveBeenCalledOnce()
    await press('S', { metaKey: true })
    expect(saveAll).toHaveBeenCalledTimes(2)
    expect((await press('s', {})).defaultPrevented).toBe(false)
    expect((await press('b')).defaultPrevented).toBe(false)
    expect((await press('s', { ctrlKey: true, altKey: true })).defaultPrevented).toBe(false)
    modal.open = true; document.body.append(modal)
    await press('s'); await press('o'); await press('n')
    expect(saveAll).toHaveBeenCalledTimes(2)
    expect(openFile).toHaveBeenCalledOnce()
    expect(createNewFile).toHaveBeenCalledOnce()
    await act(async () => root.unmount())
    modal.remove()
    await press('s')
    expect(saveAll).toHaveBeenCalledTimes(2)
  } finally { modal.remove(); await act(async () => root.unmount()) }
})

it('keeps recent folders inside File and reopens the selected path', async () => {
  const previous = useSessionStore.getState().recentWorkspaces
  useSessionStore.getState().setRecentWorkspaces(['/books/Adventure', '/notes/Research'])
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    await act(async () => root.render(<MenuBar visiblePanels={{ files: true, templates: true, snippets: true, git: true, properties: true }} onTogglePanel={() => {}} />))
    const file = container.querySelector('details')!
    const recent = file.querySelector<HTMLElement>('[aria-label="Recent folders"]')!
    expect(recent).not.toBeNull()
    expect(Array.from(recent.querySelectorAll('button')).map(button => button.title)).toEqual(['/books/Adventure', '/notes/Research'])
    file.open = true
    await act(async () => recent.querySelector<HTMLButtonElement>('[title="/notes/Research"]')!.click())
    expect(openRecent).toHaveBeenCalledWith('/notes/Research')
    expect(file.open).toBe(false)
    await act(async () => useSessionStore.getState().setRecentWorkspaces([]))
    expect(file.textContent).toContain('No recent folders')
  } finally {
    await act(async () => root.unmount())
    useSessionStore.getState().setRecentWorkspaces(previous)
  }
})

it('opens About and Tutorial from Settings, closes menus, and restores Settings focus', async () => {
  const originalShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal')
  const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close')
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value(this: HTMLDialogElement) { this.open = true } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value(this: HTMLDialogElement) { this.open = false } })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => root.render(<MenuBar visiblePanels={{ files: true, templates: true, snippets: true, git: true, properties: true }} onTogglePanel={() => {}} />))
    const settings = Array.from(container.querySelectorAll('nav > details')).find((menu) => menu.querySelector('summary')?.textContent === 'Settings')! as HTMLDetailsElement
    for (const [label, content] of [['About', 'apps@jfespanolito.dev'], ['Tutorial', 'Step 1 of 6']]) {
      settings.open = true
      const action = Array.from(settings.querySelectorAll('button')).find((button) => button.textContent === label)
      expect(action).toBeDefined()
      await act(async () => action!.click())
      expect(settings.open).toBe(false)
      expect(container.querySelector('dialog')?.textContent).toContain(content)
      await act(async () => container.querySelector<HTMLButtonElement>(`[aria-label="Close ${label}"]`)!.click())
      expect(container.querySelector('dialog')).toBeNull()
      expect(document.activeElement).toBe(settings.querySelector('summary'))
    }
  } finally {
    await act(async () => root.unmount())
    container.remove()
    if (originalShow) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', originalShow)
    else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
    if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, 'close', originalClose)
    else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close')
  }
})

describe('Insert menu', () => {
  const panels = { files: true, templates: true, snippets: true, git: true, properties: true }
  let editor: Editor | null = null
  afterEach(() => { editor?.destroy(); editor = null })
  const mount = async (value: Editor | null) => {
    const container = document.createElement('div')
    const root = createRoot(container)
    await act(async () => root.render(<MenuBar visiblePanels={panels} onTogglePanel={() => {}} editor={value} />))
    const menu = Array.from(container.querySelectorAll('details')).find((item) => item.querySelector('summary')?.textContent === 'Insert')!
    const item = (label: string) => Array.from(menu.querySelectorAll('button')).find((button) => button.textContent === label)!
    return { container, menu, item, unmount: () => act(async () => root.unmount()) }
  }
  const markdown = (value: Editor) => (value.storage as unknown as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown()

  it('lists Table, Image, Horizontal Rule and Quote, disabled without an editor', async () => {
    const { menu, unmount } = await mount(null)
    const buttons = Array.from(menu.querySelectorAll('button'))
    expect(buttons.map((button) => button.textContent)).toEqual(['Table', 'Image…', 'Horizontal Rule', 'Quote', 'Floating Box', 'Section Break'])
    expect(buttons.every((button) => button.disabled)).toBe(true)
    await unmount()
  })

  it('inserts a table, a rule and a quote into the active editor', async () => {
    editor = new Editor({ extensions: [StarterKit, Markdown, ...TableExtensions], content: 'Sample' })
    const { item, unmount } = await mount(editor)
    await act(async () => item('Table').click())
    expect(editor.getJSON().content?.some((node) => node.type === 'table')).toBe(true)
    await act(async () => { editor!.commands.setContent('Sample'); editor!.commands.setTextSelection(3) })
    await act(async () => item('Horizontal Rule').click())
    expect(markdown(editor)).toContain('---')
    await act(async () => { editor!.commands.setContent('Sample'); editor!.commands.setTextSelection(3) })
    await act(async () => item('Quote').click())
    expect(markdown(editor)).toContain('>')
    await unmount()
  })

  it('asks to save an unsaved document before importing an image', async () => {
    useDocumentStore.getState().loadFromRaw(null, '')
    editor = new Editor({ extensions: [StarterKit] })
    const { container, item, unmount } = await mount(editor)
    await act(async () => item('Image…').click())
    expect(container.textContent).toContain('Save this document as Markdown before importing an image.')
    expect(importImage).not.toHaveBeenCalled()
    await unmount()
  })

  it('opens the image picker for a saved document', async () => {
    useDocumentStore.getState().loadFromRaw('/workspace/Draft/Chapter.md', '')
    vi.mocked(importImage).mockResolvedValue(null)
    editor = new Editor({ extensions: [StarterKit] })
    const { item, unmount } = await mount(editor)
    await act(async () => item('Image…').click())
    expect(importImage).toHaveBeenCalledWith('/workspace/Draft/Chapter.md', null)
    expect(refreshTree).toHaveBeenCalledOnce()
    await unmount()
  })
  it('places a chosen image centered, 55 mm wide, shadowed and pushing text, with its file name as alt text', async () => {
    useDocumentStore.getState().loadFromRaw('/workspace/Draft/Chapter.md', '')
    vi.mocked(importImage).mockResolvedValue('../Assets/The Map.v2.png')
    editor = new Editor({ extensions: [StarterKit, GrimoireImage] })
    const { item, unmount } = await mount(editor)
    await act(async () => item('Image…').click())
    expect(editor.getJSON().content?.find((node) => node.type === 'image')?.attrs).toMatchObject({
      src: '../Assets/The Map.v2.png', alt: 'The Map.v2', align: 'center', widthMm: 55, frame: 'shadow', opacity: 1, anchor: 'flow',
    })
    await unmount()
  })
})

describe('File > Export > Export as Template', () => {
  const panels = { files: true, templates: true, snippets: true, git: true, properties: true }
  const mount = async () => {
    HTMLDialogElement.prototype.showModal = function () { this.open = true }
    HTMLDialogElement.prototype.close = function () { this.open = false }
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => root.render(<MenuBar visiblePanels={panels} onTogglePanel={() => {}} />))
    const file = Array.from(container.querySelectorAll('nav > details')).find((menu) => menu.querySelector('summary')?.textContent === 'File')!
    const entry = () => Array.from(file.querySelectorAll('button')).find((button) => button.textContent === 'Export as Template') as HTMLButtonElement
    return { container, file, entry, unmount: async () => { await act(async () => root.unmount()); container.remove() } }
  }
  afterEach(() => useDocumentStore.setState({ workspaceRoot: null }))

  it('lists the entry under an Export submenu and disables it without a project', async () => {
    useDocumentStore.setState({ workspaceRoot: null })
    const { file, entry, unmount } = await mount()
    const submenu = Array.from(file.querySelectorAll('details')).find((menu) => menu.querySelector('summary')?.textContent === 'Export')
    expect(submenu).toBeDefined()
    expect(submenu!.contains(entry())).toBe(true)
    expect(entry().disabled).toBe(true)
    await unmount()
  })

  it('opens Create Mod on the Templates tab for the open project and can continue to the Theme Customizer', async () => {
    useDocumentStore.setState({ workspaceRoot: '/books/Dragon Curse' })
    const { container, entry, unmount } = await mount()
    expect(entry().disabled).toBe(false)
    await act(async () => entry().click())
    expect(container.querySelector('#create-mod-title')?.textContent).toBe('Create Mod')
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Templates')
    expect(container.textContent).toContain('Grimorio activo: Dragon Curse')

    await act(async () => container.querySelector<HTMLButtonElement>('#create-mod-tab-Themes')!.click())
    await act(async () => (Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Open Theme Customizer') as HTMLButtonElement).click())
    expect(container.querySelector('#create-mod-title')).toBeNull()
    expect(container.querySelector('[data-testid="preferences"]')?.getAttribute('data-customizing')).toBe('true')
    await unmount()
  })
})

it('opens the one Find panel from the Document menu, Ctrl+F and Ctrl+H, and steps with F3 while it is open', async () => {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const modal = document.createElement('dialog')
  const press = async (key: string, modifiers: KeyboardEventInit = { ctrlKey: true }) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers })
    await act(async () => window.dispatchEvent(event))
    return event
  }
  useTabStore.getState().reset(null)
  useFindStore.setState({ open: false, term: '', focusToken: 0, step: { direction: 1, token: 0 } })
  try {
    await act(async () => root.render(<MenuBar visiblePanels={{ files: true, templates: true, snippets: true, git: true, properties: true }} onTogglePanel={() => {}} />))
    const entry = Array.from(container.querySelectorAll('nav > details')).find((menu) => menu.querySelector('summary')?.textContent === 'Document')!
      .querySelector<HTMLButtonElement>('button[aria-keyshortcuts="Control+F"]')!
    expect(entry.textContent).toBe('Find and Replace…Ctrl+F')
    await act(async () => entry.click())
    expect(useFindStore.getState().open).toBe(true)

    useFindStore.getState().hide()
    expect((await press('f')).defaultPrevented).toBe(true)
    expect(useFindStore.getState().open).toBe(true)
    expect(useFindStore.getState().focusTarget).toBe('find')
    await press('h')
    expect(useFindStore.getState().focusTarget).toBe('replace')

    await press('F3', {})
    await press('F3', { shiftKey: true })
    expect(useFindStore.getState().step).toEqual({ direction: -1, token: 2 })

    // An open panel does not stop the other shortcuts; a modal dialog does stop Find.
    saveAll.mockClear()
    const panel = document.createElement('dialog')
    panel.setAttribute('data-find-panel', '')
    panel.open = true
    document.body.append(panel)
    await press('s')
    expect(saveAll).toHaveBeenCalledOnce()
    panel.remove()
    useFindStore.getState().hide()
    modal.open = true; document.body.append(modal)
    expect((await press('f')).defaultPrevented).toBe(true)
    expect(useFindStore.getState().open).toBe(false)
    modal.remove()

    // F3 does nothing while the panel is closed.
    const closed = await press('F3', {})
    expect(closed.defaultPrevented).toBe(false)
  } finally { modal.remove(); container.remove(); await act(async () => root.unmount()) }
})
