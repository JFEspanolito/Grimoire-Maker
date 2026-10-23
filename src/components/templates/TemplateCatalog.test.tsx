import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { TemplateCatalog } from './TemplateCatalog'

const mocks = vi.hoisted(() => ({
  apply: vi.fn().mockResolvedValue(true),
  export: vi.fn().mockResolvedValue(true),
  import: vi.fn().mockResolvedValue('classic-fantasy'),
  reload: vi.fn(),
  template: { id: 'classic-fantasy', label: 'Classic Fantasy', frontmatter: {}, body: '# Demo', builtin: false },
}))
vi.mock('../../hooks/useFileSystem', () => ({ isTauri: () => true, useFileSystem: () => ({ applyTemplate: mocks.apply }) }))
vi.mock('../../stores/templateStore', () => ({ useTemplateStore: () => ({ templates: [mocks.template], errors: [], reload: mocks.reload }) }))
vi.mock('../../lib/templateActions', () => ({ exportTemplateZip: mocks.export, importTemplateZip: mocks.import }))

it('shows template names and format-neutral controls without changing their actions', async () => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    await act(async () => root.render(<TemplateCatalog />))
    await act(async () => container.querySelector('button')?.click())
    expect(container.textContent).not.toMatch(/zip/i)
    const apply = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Classic Fantasy')
    expect(apply).toBeDefined()
    await act(async () => apply?.click())
    expect(mocks.apply).toHaveBeenCalledWith(mocks.template)
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
  }
})
