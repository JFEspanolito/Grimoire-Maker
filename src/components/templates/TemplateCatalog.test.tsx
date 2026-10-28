import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { TemplateCatalog } from './TemplateCatalog'

const mocks = vi.hoisted(() => ({
  apply: vi.fn().mockResolvedValue(true),
  createProject: vi.fn().mockResolvedValue(true),
  export: vi.fn().mockResolvedValue(true),
  import: vi.fn().mockResolvedValue('classic-fantasy'),
  reload: vi.fn(),
  workspaceRoot: '/project' as string | null,
  template: {
    id: 'classic-fantasy',
    label: 'Classic Fantasy',
    frontmatter: {},
    body: '# Demo',
    builtin: false,
    requiresProject: true,
    location: { kind: 'package' as const, path: '/mods/Templates/classic-fantasy' },
  },
}))
vi.mock('../../hooks/useFileSystem', () => ({ isTauri: () => true, useFileSystem: () => ({ applyTemplate: mocks.apply, createProject: mocks.createProject }) }))
vi.mock('../../stores/templateStore', () => ({ useTemplateStore: () => ({ templates: [mocks.template], errors: [], reload: mocks.reload }) }))
vi.mock('../../stores/documentStore', () => ({ useDocumentStore: (selector: (state: { workspaceRoot: string | null }) => unknown) => selector({ workspaceRoot: mocks.workspaceRoot }) }))
vi.mock('../../lib/templateActions', () => ({ exportTemplateZip: mocks.export, importTemplateZip: mocks.import }))

it('is expanded by default when no project is open and collapsed by default when a project is open', async () => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    mocks.workspaceRoot = null
    await act(async () => root.render(<TemplateCatalog />))
    expect(container.querySelector('button')?.getAttribute('aria-expanded')).toBe('true')
    expect(container.textContent).toContain('Classic Fantasy')

    mocks.workspaceRoot = '/project'
    await act(async () => root.render(<TemplateCatalog />))
    expect(container.querySelector('button')?.getAttribute('aria-expanded')).toBe('false')
  } finally {
    mocks.workspaceRoot = '/project'
    await act(async () => root.unmount())
  }
})

it('creates a project first when applying a package template without an active project', async () => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  const showModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal')
  const close = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close')
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value(this: HTMLDialogElement) { this.open = true } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value(this: HTMLDialogElement) { this.open = false } })
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    mocks.workspaceRoot = null
    mocks.apply.mockClear()
    mocks.createProject.mockClear()
    await act(async () => root.render(<TemplateCatalog />))
    const applyBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Classic Fantasy')
    await act(async () => applyBtn?.click())
    const createAndApply = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Elegir carpeta y crear proyecto')
    expect(createAndApply).toBeDefined()
    await act(async () => createAndApply?.click())
    expect(mocks.createProject).toHaveBeenCalledWith('Classic Fantasy')
    expect(mocks.apply).toHaveBeenCalledWith(mocks.template, { replaceExisting: true })
  } finally {
    mocks.workspaceRoot = '/project'
    await act(async () => root.unmount())
    if (showModal) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', showModal)
    else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
    if (close) Object.defineProperty(HTMLDialogElement.prototype, 'close', close)
    else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close')
  }
})

it('shows template names and format-neutral controls without changing their actions', async () => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  const showModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal')
  const close = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close')
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value(this: HTMLDialogElement) {
    this.open = true
  } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value(this: HTMLDialogElement) {
    this.open = false
  } })
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    await act(async () => root.render(<TemplateCatalog />))
    await act(async () => container.querySelector('button')?.click())
    expect(container.textContent).not.toMatch(/zip/i)
    const apply = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Classic Fantasy')
    expect(apply).toBeDefined()
    await act(async () => apply?.click())
    expect(mocks.apply).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Añadir esto al proyecto actual')
    expect(container.textContent).toContain('Reemplazar existente')
    const cancel = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Cancelar')
    await act(async () => cancel?.click())
    expect(mocks.apply).not.toHaveBeenCalled()
    await act(async () => apply?.click())
    const add = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Añadir esto al proyecto actual')
    await act(async () => add?.click())
    expect(mocks.apply).toHaveBeenCalledWith(mocks.template, { replaceExisting: false })
    await act(async () => apply?.click())
    const replace = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Reemplazar existente')
    await act(async () => replace?.click())
    expect(mocks.apply).toHaveBeenLastCalledWith(mocks.template, { replaceExisting: true })
    const exportButton = container.querySelector<HTMLButtonElement>('[aria-label="Export Classic Fantasy"]')
    expect(exportButton?.title).toBe('Export template')
    await act(async () => exportButton?.click())
    expect(mocks.export).toHaveBeenCalledWith(mocks.template)
    const importButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Import…')
    expect(importButton).toBeDefined()
    await act(async () => importButton?.click())
    expect(mocks.import).toHaveBeenCalledOnce()
    expect(mocks.reload).toHaveBeenCalledOnce()
  } finally {
    await act(async () => root.unmount())
    if (showModal) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', showModal)
    else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
    if (close) Object.defineProperty(HTMLDialogElement.prototype, 'close', close)
    else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close')
    vi.restoreAllMocks()
  }
})
