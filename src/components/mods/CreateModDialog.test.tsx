import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { CreateModDialog, type CreateModTab } from './CreateModDialog'
import { useModStore } from '../../stores/modStore'
import { useThemeStore } from '../../stores/themeStore'
import { useDocumentStore } from '../../stores/documentStore'
import { useToastStore } from '../../stores/toastStore'

const mocks = vi.hoisted(() => ({
  exportTheme: vi.fn(),
  exportSnippet: vi.fn(),
  exportSnippetPackFrom: vi.fn(),
  exportProjectAsTemplate: vi.fn(),
  saveSnippetToLibrary: vi.fn(),
  createPluginFromInput: vi.fn(),
}))
vi.mock('../../lib/modExport', () => ({
  exportTheme: mocks.exportTheme,
  exportSnippet: mocks.exportSnippet,
  exportSnippetPackFrom: mocks.exportSnippetPackFrom,
  exportProjectAsTemplate: mocks.exportProjectAsTemplate,
}))
vi.mock('../../lib/snippetLibrary', () => ({ saveSnippetToLibrary: mocks.saveSnippetToLibrary }))
vi.mock('../../lib/pluginCreator', async (original) => ({ ...(await original<typeof import('../../lib/pluginCreator')>()), createPluginFromInput: mocks.createPluginFromInput }))
vi.mock('../../lib/errorLogging', async (original) => ({ ...(await original<typeof import('../../lib/errorLogging')>()), reportError: vi.fn() }))

let root: Root
let container: HTMLDivElement
const reload = vi.fn(async () => {})
const openCustomizer = vi.fn()
const close = vi.fn()

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  // jsdom has no native dialog implementation.
  HTMLDialogElement.prototype.showModal = function () { this.open = true }
  HTMLDialogElement.prototype.close = function () { this.open = false }
})

beforeEach(() => {
  useThemeStore.setState({
    userThemes: [
      { id: 'arcane', name: 'Arcane Ink', builtin: false },
      { id: 'ember', name: 'Ember', builtin: false },
    ],
  })
  useDocumentStore.setState({ workspaceRoot: '/books/Dragon Curse' })
  useModStore.setState({
    reload,
    snippets: [
      { id: 'dnd/table', label: 'Encounter Table', group: 'Dungeons', markdown: '| d6 | Foe |' },
      { id: 'dnd/quote', label: 'Villain Quote', group: 'Dungeons', markdown: '> Bow.' },
      { id: 'zine/frame', label: 'Frame', group: 'Zine', markdown: 'Frame' },
    ],
  })
  mocks.saveSnippetToLibrary.mockResolvedValue({ path: '/mods/Snippets/Dungeons/Orc-Camp.md' })
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.clearAllMocks()
  mocks.exportTheme.mockReset()
  mocks.exportSnippet.mockReset()
  mocks.exportSnippetPackFrom.mockReset()
  mocks.exportProjectAsTemplate.mockReset()
  mocks.createPluginFromInput.mockReset()
  useToastStore.setState({ toasts: [] })
  useDocumentStore.setState({ workspaceRoot: null })
})

async function mount(initialTab?: CreateModTab) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(<CreateModDialog initialTab={initialTab} onClose={close} onOpenThemeCustomizer={openCustomizer} />))
}

const button = (label: string) => Array.from(container.querySelectorAll('button')).find((item) => item.textContent === label) as HTMLButtonElement
const click = (element: Element | undefined | null) => act(async () => (element as HTMLElement).click())
async function type(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const field = <T extends HTMLElement>(label: string) =>
  Array.from(container.querySelectorAll('label')).find((item) => item.querySelector('span')?.textContent === label)!.querySelector<T>('input, textarea, select')!
const panel = (tab: CreateModTab) => container.querySelector<HTMLElement>(`#create-mod-panel-${tab}`)!

it('opens as a modal with the four tabs and can start on the Templates tab', async () => {
  await mount()
  expect(container.querySelector('dialog')?.open).toBe(true)
  expect(container.querySelector('dialog')?.getAttribute('aria-labelledby')).toBe('create-mod-title')
  expect(container.querySelector('#create-mod-title')?.textContent).toBe('Create Mod')
  const tabs = Array.from(container.querySelectorAll('[role="tab"]'))
  expect(tabs.map((tab) => tab.textContent)).toEqual(['Themes', 'Snippets', 'Templates', 'Plugins'])
  expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false', 'false'])
  expect(panel('Themes').hidden).toBe(false)
  expect(panel('Templates').hidden).toBe(true)
  await click(tabs[2])
  expect(tabs[2].getAttribute('aria-selected')).toBe('true')
  expect(panel('Templates').hidden).toBe(false)
  await click(container.querySelector('[aria-label="Close Create Mod"]'))
  expect(close).toHaveBeenCalledOnce()

  await act(async () => root.unmount())
  container.remove()
  await mount('Templates')
  expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Templates')
  expect(panel('Templates').hidden).toBe(false)
})

it('exports the selected installed theme, shows where it was saved and keeps quiet when cancelled', async () => {
  await mount('Themes')
  expect(button('Export Selected Theme').disabled).toBe(true)
  expect(container.textContent).toContain('o diseña uno nuevo')
  expect(container.querySelector('[role="separator"]')?.textContent).toBe('o diseña uno nuevo')
  expect(container.textContent).toContain('.css file, or a .zip when the theme carries its own fonts or images')
  const select = container.querySelector<HTMLSelectElement>('select[aria-label="Installed theme"]')!
  expect(Array.from(select.options).map((option) => option.textContent)).toEqual(['Select a theme…', 'Arcane Ink', 'Ember'])

  await act(async () => {
    select.value = 'ember'
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  mocks.exportTheme.mockResolvedValueOnce(null)
  await click(button('Export Selected Theme'))
  expect(mocks.exportTheme).toHaveBeenCalledExactlyOnceWith('ember')
  expect(container.querySelector('[role="status"]')).toBeNull()

  mocks.exportTheme.mockResolvedValueOnce('/home/me/ember.css')
  await click(button('Export Selected Theme'))
  expect(container.querySelector('[role="status"]')?.textContent).toBe('Theme saved to /home/me/ember.css')
})

it('shows a plain sentence when a theme export fails', async () => {
  await mount('Themes')
  const select = container.querySelector<HTMLSelectElement>('select[aria-label="Installed theme"]')!
  await act(async () => { select.value = 'arcane'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  mocks.exportTheme.mockRejectedValueOnce(new Error('The theme file is missing from the themes folder.'))
  await click(button('Export Selected Theme'))
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('The theme file is missing from the themes folder.')
})

it('opens the Theme Customizer from the Themes tab', async () => {
  await mount('Themes')
  await click(button('Open Theme Customizer'))
  expect(openCustomizer).toHaveBeenCalledOnce()
})

it('disables the Templates form and explains why when no project is open', async () => {
  useDocumentStore.setState({ workspaceRoot: null })
  await mount('Templates')
  expect(panel('Templates').textContent).toContain('Open a project folder to export it as a template.')
  expect(panel('Templates').textContent).not.toContain('Grimorio activo')
  for (const element of panel('Templates').querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement>('input, textarea, button')) {
    expect(element.matches(':disabled')).toBe(true)
  }
})

it('validates the template name and exports with the exact metadata for both content choices', async () => {
  useDocumentStore.setState({ workspaceRoot: 'C:\\Books\\La Maldición del Dragón' })
  await mount('Templates')
  expect(panel('Templates').textContent).toContain('Grimorio activo: La Maldición del Dragón')
  expect((container.querySelector('input[name="template-contents"]') as HTMLInputElement).checked).toBe(true)

  await click(button('Export Current Project as Template'))
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('Enter a template name.')
  expect(mocks.exportProjectAsTemplate).not.toHaveBeenCalled()

  mocks.exportProjectAsTemplate.mockResolvedValueOnce({ path: '/out/base.zip', warnings: [] })
  await type(field('Template Name'), '  Base Campaign ')
  await type(field('Description'), 'Starter tree')
  await type(field('Author'), 'JF')
  await click(button('Export Current Project as Template'))
  expect(mocks.exportProjectAsTemplate).toHaveBeenLastCalledWith({ name: 'Base Campaign', description: 'Starter tree', author: 'JF', includeContent: true })
  expect(container.querySelector('[role="alert"]')).toBeNull()
  expect(Array.from(container.querySelectorAll('[role="status"]')).map((item) => item.textContent)).toContain('Template saved to /out/base.zip')

  const radios = Array.from(container.querySelectorAll<HTMLInputElement>('input[name="template-contents"]'))
  expect(radios.map((radio) => radio.parentElement?.textContent?.trim())).toEqual([
    'Incluir contenido de los archivos', 'Solo estructura de carpetas y archivos en blanco',
  ])
  await click(radios[1])
  await type(field('Description'), '')
  await type(field('Author'), '')
  mocks.exportProjectAsTemplate.mockResolvedValueOnce({ path: '/out/base.zip', warnings: [] })
  await click(button('Export Current Project as Template'))
  expect(mocks.exportProjectAsTemplate).toHaveBeenLastCalledWith({ name: 'Base Campaign', includeContent: false })
})

it('lists template export warnings behind Details and shows nothing when the save dialog is cancelled', async () => {
  await mount('Templates')
  await type(field('Template Name'), 'Base')
  mocks.exportProjectAsTemplate.mockResolvedValueOnce(null)
  await click(button('Export Current Project as Template'))
  expect(container.querySelector('[role="status"]')).toBeNull()
  expect(container.querySelector('details')).toBeNull()

  mocks.exportProjectAsTemplate.mockResolvedValueOnce({ path: '/out/base.zip', warnings: ['Skipped .git', 'Image outside the project'] })
  await click(button('Export Current Project as Template'))
  const details = container.querySelector('details')!
  expect(details.querySelector('summary')?.textContent).toContain('Details')
  expect(Array.from(details.querySelectorAll('li')).map((item) => item.textContent)).toEqual(['Skipped .git', 'Image outside the project'])
})

it('shows a plain sentence when a template export fails', async () => {
  await mount('Templates')
  await type(field('Template Name'), 'Base')
  mocks.exportProjectAsTemplate.mockRejectedValueOnce(new Error('The project has too many files to share.'))
  await click(button('Export Current Project as Template'))
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('The project has too many files to share.')
})

it('has only the new-snippet form: no list of existing snippets, selection or per-snippet export', async () => {
  await mount('Snippets')
  expect(panel('Snippets').querySelectorAll('[role="group"], input[type="checkbox"]').length).toBe(0)
  const labels = Array.from(panel('Snippets').querySelectorAll('button')).map((item) => item.textContent)
  expect(labels).toEqual(['Save to Snippets'])
  expect(panel('Snippets').textContent).not.toContain('Existing snippets')
})

it('validates a new snippet, saves it to the library, reloads the mod catalog and shows the toast', async () => {
  await mount('Snippets')
  await click(button('Save to Snippets'))
  expect(Array.from(container.querySelectorAll('[role="alert"]')).map((item) => item.textContent)).toEqual(['Enter a snippet name.'])
  await type(field('Snippet Name'), 'Orc Camp')
  await click(button('Save to Snippets'))
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('Add some Markdown content for the snippet.')
  expect(mocks.saveSnippetToLibrary).not.toHaveBeenCalled()

  const categoryList = container.querySelector('datalist')!
  expect(Array.from(categoryList.querySelectorAll('option')).map((option) => option.value)).toEqual(['Dungeons', 'Zine'])
  const markdown = field<HTMLTextAreaElement>('Markdown')
  expect(markdown.tagName).toBe('TEXTAREA')
  await type(field('Category / Folder'), 'Dungeons')
  await type(markdown, '## Orc Camp\n\nSmoke.')
  mocks.exportSnippetPackFrom.mockResolvedValueOnce('/out/orc.zip')
  await click(button('Save to Snippets'))
  expect(mocks.saveSnippetToLibrary).toHaveBeenCalledExactlyOnceWith({ name: 'Orc Camp', category: 'Dungeons', markdown: '## Orc Camp\n\nSmoke.' })
  expect(reload).toHaveBeenCalledOnce()
  expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual(['Snippet añadido a la paleta lateral'])
  expect(container.querySelector('[role="alert"]')).toBeNull()
  expect(field<HTMLInputElement>('Snippet Name').value).toBe('')
  // Then the zip of that snippet is built and the save dialog opens.
  expect(mocks.exportSnippetPackFrom).toHaveBeenCalledExactlyOnceWith([{ name: 'Orc Camp', category: 'Dungeons', markdown: '## Orc Camp\n\nSmoke.' }])
  expect(container.querySelector('[role="status"]')?.textContent).toBe('Snippet added to your library (/mods/Snippets/Dungeons/Orc-Camp.md). Zip saved to /out/orc.zip')
})

it('reports a failed snippet save in plain words without a toast or reload', async () => {
  await mount('Snippets')
  await type(field('Snippet Name'), 'Orc Camp')
  await type(field<HTMLTextAreaElement>('Markdown'), 'text')
  mocks.saveSnippetToLibrary.mockRejectedValueOnce(new Error('A snippet with this name already exists.'))
  await click(button('Save to Snippets'))
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('A snippet with this name already exists.')
  expect(reload).not.toHaveBeenCalled()
  expect(useToastStore.getState().toasts).toEqual([])
  expect(mocks.exportSnippetPackFrom).not.toHaveBeenCalled()
})

it('keeps the library save when the zip dialog is cancelled and says the zip was not saved', async () => {
  await mount('Snippets')
  await type(field('Snippet Name'), 'Orc Camp')
  await type(field<HTMLTextAreaElement>('Markdown'), 'text')
  mocks.exportSnippetPackFrom.mockResolvedValueOnce(null)
  await click(button('Save to Snippets'))
  expect(mocks.saveSnippetToLibrary).toHaveBeenCalledOnce()
  expect(reload).toHaveBeenCalledOnce()
  expect(container.querySelector('[role="status"]')?.textContent).toBe('Snippet added to your library (/mods/Snippets/Dungeons/Orc-Camp.md). The zip was not saved.')
  expect(container.querySelector('[role="alert"]')).toBeNull()
})

it('keeps the library save and shows a plain error when the zip fails', async () => {
  await mount('Snippets')
  await type(field('Snippet Name'), 'Orc Camp')
  await type(field<HTMLTextAreaElement>('Markdown'), 'text')
  mocks.exportSnippetPackFrom.mockRejectedValueOnce(new Error('Disk is full.'))
  await click(button('Save to Snippets'))
  expect(reload).toHaveBeenCalledOnce()
  expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual(['Snippet añadido a la paleta lateral'])
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('The snippet was added to your library, but the zip could not be saved.')
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Disk is full.')
})

/* ---- Plugins tab ---------------------------------------------------------------------------- */

const pfield = <T extends HTMLElement>(label: string) =>
  Array.from(panel('Plugins').querySelectorAll('label')).find((item) => item.querySelector('span')?.textContent === label)!.querySelector<T>('input, textarea')!
const buttonsIn = () => Array.from(panel('Plugins').querySelectorAll('ol > li'))
const pluginErrors = () => Array.from(panel('Plugins').querySelectorAll('span[id]')).map((item) => item.textContent)
async function fillPlugin(markdown = '## Hi') {
  await type(pfield('Plugin Name'), '  Encounter Tools ')
  await type(pfield('Button label'), ' Hello ')
  await type(pfield<HTMLTextAreaElement>('Markdown to insert'), markdown)
}

it('adds a selectable Plugins tab after Templates with the capability summary', async () => {
  await mount()
  const tab = Array.from(container.querySelectorAll('[role="tab"]')).at(-1)!
  expect(tab.textContent).toBe('Plugins')
  await click(tab)
  expect(tab.getAttribute('aria-selected')).toBe('true')
  expect(panel('Plugins').hidden).toBe(false)
  expect(panel('Templates').hidden).toBe(true)
  expect(panel('Plugins').textContent).toContain('This plugin will be able to: insert the text you wrote when you press its buttons. It cannot read your pages, files or network.')
  expect(buttonsIn()).toHaveLength(1)
  expect(pfield<HTMLTextAreaElement>('Markdown to insert').tagName).toBe('TEXTAREA')
})

it('shows field errors only after the first submit, then as the user types', async () => {
  await mount('Plugins')
  expect(pluginErrors()).toEqual([])
  await click(button('Create Plugin'))
  expect(mocks.createPluginFromInput).not.toHaveBeenCalled()
  expect(pluginErrors()).toEqual(['Enter a plugin name.', 'Enter a button label.', 'Enter the text this button inserts.'])
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('Fix the highlighted fields and try again.')
  await type(pfield('Plugin Name'), 'Ok')
  expect(pluginErrors()).toEqual(['Enter a button label.', 'Enter the text this button inserts.'])
  await type(pfield<HTMLTextAreaElement>('Markdown to insert'), '[a](https://x.test)')
  expect(pluginErrors().at(-1)).toContain('http:')
  await type(pfield('Author'), 'a'.repeat(65))
  expect(pluginErrors()).toContain('The author must be 64 characters or fewer.')
})

it('shows errors after the first blur without submitting', async () => {
  await mount('Plugins')
  await act(async () => { pfield('Plugin Name').dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
  expect(pluginErrors()).toContain('Enter a plugin name.')
})

it('adds buttons up to 12 and removes them down to 1', async () => {
  await mount('Plugins')
  expect(container.querySelector<HTMLButtonElement>('[aria-label="Remove button 1"]')!.disabled).toBe(true)
  for (let i = 0; i < 11; i++) await click(button('Add button'))
  expect(buttonsIn()).toHaveLength(12)
  expect(button('Add button').disabled).toBe(true)
  await click(container.querySelector('[aria-label="Remove button 12"]'))
  expect(buttonsIn()).toHaveLength(11)
  expect(button('Add button').disabled).toBe(false)
  for (let i = 0; i < 10; i++) await click(container.querySelector('[aria-label="Remove button 1"]'))
  expect(buttonsIn()).toHaveLength(1)
  expect(container.querySelector<HTMLButtonElement>('[aria-label="Remove button 1"]')!.disabled).toBe(true)
})

it('creates the plugin with the exact input, reloads the catalog, toasts and resets the form', async () => {
  await mount('Plugins')
  mocks.createPluginFromInput.mockResolvedValueOnce({ folder: 'encounter-tools', id: 'custom.encounter-tools', path: '/mods/Plugins/encounter-tools' })
  await fillPlugin('## Hi\n\ntext')
  await type(pfield('Author'), ' JF ')
  await click(button('Add button'))
  const labels = Array.from(panel('Plugins').querySelectorAll<HTMLInputElement>('ol input'))
  const areas = Array.from(panel('Plugins').querySelectorAll<HTMLTextAreaElement>('ol textarea'))
  await type(labels[1], 'Second')
  await type(areas[1], 'two')
  await click(button('Create Plugin'))
  expect(mocks.createPluginFromInput).toHaveBeenCalledExactlyOnceWith({
    name: 'Encounter Tools', author: 'JF',
    buttons: [{ label: 'Hello', markdown: '## Hi\n\ntext' }, { label: 'Second', markdown: 'two' }],
  })
  expect(reload).toHaveBeenCalledOnce()
  expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual(['Plugin created. Find it in Mod Manager > Plugins.'])
  expect(Array.from(container.querySelectorAll('[role="status"]')).map((item) => item.textContent)).toContain('Plugin "Encounter Tools" created in /mods/Plugins/encounter-tools')
  expect(container.querySelector('[role="alert"]')).toBeNull()
  expect(pfield<HTMLInputElement>('Plugin Name').value).toBe('')
  expect(pfield<HTMLInputElement>('Author').value).toBe('')
  expect(buttonsIn()).toHaveLength(1)
  expect(pfield<HTMLInputElement>('Button label').value).toBe('')
  expect(pluginErrors()).toEqual([])
})

it('reports a failed creation in plain words without a toast, reload or form reset', async () => {
  await mount('Plugins')
  await fillPlugin()
  mocks.createPluginFromInput.mockRejectedValueOnce(new Error('The Plugins folder is not writable.'))
  await click(button('Create Plugin'))
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('The Plugins folder is not writable.')
  expect(reload).not.toHaveBeenCalled()
  expect(useToastStore.getState().toasts).toEqual([])
  expect(pfield<HTMLInputElement>('Plugin Name').value).toBe('  Encounter Tools ')
})

it('still reports success when the catalog refresh fails after the plugin was written', async () => {
  await mount('Plugins')
  await fillPlugin()
  mocks.createPluginFromInput.mockResolvedValueOnce({ folder: 'f', id: 'custom.f', path: '/p/f' })
  reload.mockRejectedValueOnce(new Error('scan failed'))
  await click(button('Create Plugin'))
  expect(container.querySelector('[role="alert"]')).toBeNull()
  expect(useToastStore.getState().toasts).toHaveLength(1)
})

it('disables the form while the plugin is being written', async () => {
  await mount('Plugins')
  await fillPlugin()
  let finish!: (value: { folder: string; id: string; path: string }) => void
  mocks.createPluginFromInput.mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
  await click(button('Create Plugin'))
  expect(button('Create Plugin').disabled).toBe(true)
  expect(button('Add button').disabled).toBe(true)
  expect(pfield<HTMLInputElement>('Plugin Name').disabled).toBe(true)
  await click(button('Create Plugin'))
  expect(mocks.createPluginFromInput).toHaveBeenCalledOnce()
  await act(async () => finish({ folder: 'f', id: 'custom.f', path: '/p/f' }))
  expect(button('Create Plugin').disabled).toBe(false)
})
