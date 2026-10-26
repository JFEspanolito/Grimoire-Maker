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
  exportSnippetPack: vi.fn(),
  exportProjectAsTemplate: vi.fn(),
  saveSnippetToLibrary: vi.fn(),
}))
vi.mock('../../lib/modExport', () => ({
  exportTheme: mocks.exportTheme,
  exportSnippet: mocks.exportSnippet,
  exportSnippetPack: mocks.exportSnippetPack,
  exportProjectAsTemplate: mocks.exportProjectAsTemplate,
}))
vi.mock('../../lib/snippetLibrary', () => ({ saveSnippetToLibrary: mocks.saveSnippetToLibrary }))
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
  mocks.exportSnippetPack.mockReset()
  mocks.exportProjectAsTemplate.mockReset()
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

it('opens as a modal with the three tabs and can start on the Templates tab', async () => {
  await mount()
  expect(container.querySelector('dialog')?.open).toBe(true)
  expect(container.querySelector('dialog')?.getAttribute('aria-labelledby')).toBe('create-mod-title')
  expect(container.querySelector('#create-mod-title')?.textContent).toBe('Create Mod')
  const tabs = Array.from(container.querySelectorAll('[role="tab"]'))
  expect(tabs.map((tab) => tab.textContent)).toEqual(['Themes', 'Snippets', 'Templates'])
  expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false'])
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

it('packages the selected local snippets and exports a single one as Markdown', async () => {
  await mount('Snippets')
  expect(Array.from(panel('Snippets').querySelectorAll('[role="group"]')).map((group) => group.getAttribute('aria-label'))).toEqual(['Dungeons', 'Zine'])
  expect(button('Package selected as .zip').disabled).toBe(true)

  await click(container.querySelector('[aria-label="Select snippet Encounter Table"]'))
  await click(container.querySelector('[aria-label="Select snippet Frame"]'))
  expect(button('Package selected as .zip').disabled).toBe(false)
  mocks.exportSnippetPack.mockResolvedValueOnce('/out/pack.zip')
  await click(button('Package selected as .zip'))
  expect(mocks.exportSnippetPack).toHaveBeenCalledExactlyOnceWith(['dnd/table', 'zine/frame'])
  expect(Array.from(container.querySelectorAll('[role="status"]')).map((item) => item.textContent)).toContain('Snippet pack saved to /out/pack.zip')

  mocks.exportSnippet.mockResolvedValueOnce('/out/Villain-Quote.md')
  await click(container.querySelector('[aria-label="Export Villain Quote as .md"]'))
  expect(mocks.exportSnippet).toHaveBeenCalledExactlyOnceWith({ name: 'Villain Quote', category: 'Dungeons', markdown: '> Bow.' })
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
  await click(button('Save to Snippets'))
  expect(mocks.saveSnippetToLibrary).toHaveBeenCalledExactlyOnceWith({ name: 'Orc Camp', category: 'Dungeons', markdown: '## Orc Camp\n\nSmoke.' })
  expect(reload).toHaveBeenCalledOnce()
  expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual(['Snippet añadido a la paleta lateral'])
  expect(container.querySelector('[role="alert"]')).toBeNull()
  expect(field<HTMLInputElement>('Snippet Name').value).toBe('')
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
})
