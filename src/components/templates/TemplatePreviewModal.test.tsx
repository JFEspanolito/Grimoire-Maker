import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TemplatePreviewModal } from './TemplatePreviewModal'
import type { Template } from '../../lib/templates'

vi.mock('../editor/renderDocumentContent', () => ({
  renderDocumentHtml: vi.fn(async (markdown: string) => `<div class="mocked-html">${markdown}</div>`),
}))

const fsMocks = vi.hoisted(() => ({
  readDir: vi.fn(),
  readTextFile: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
  readDir: fsMocks.readDir,
  readTextFile: fsMocks.readTextFile,
}))

const template1: Template = {
  id: 'template-one',
  label: 'Template One',
  frontmatter: { pageSize: 'a4', columns: 2, theme: 'parchment' },
  body: '# Content One',
  builtin: true,
}

const template2: Template = {
  id: 'template-two',
  label: 'Template Two',
  frontmatter: { pageSize: 'letter', columns: 1, theme: 'modern' },
  body: '# Content Two',
  builtin: false,
}

describe('TemplatePreviewModal', () => {
  const showModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal')
  const close = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close')

  beforeEach(() => {
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value(this: HTMLDialogElement) { this.open = true } })
    Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value(this: HTMLDialogElement) { this.open = false } })
  })

  afterEach(() => {
    if (showModal) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', showModal)
    else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
    if (close) Object.defineProperty(HTMLDialogElement.prototype, 'close', close)
    else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close')
  })

  it('renders modal with select box, files list, page preview, and action buttons', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    const onClose = vi.fn()
    const onApply = vi.fn()

    try {
      await act(async () => {
        root.render(
          <TemplatePreviewModal
            template={template1}
            templates={[template1, template2]}
            hasProject={true}
            onClose={onClose}
            onApply={onApply}
          />,
        )
      })

      // Title & template selector
      expect(container.textContent).toContain('Template: Template One')
      const select = container.querySelector<HTMLSelectElement>('select[aria-label="Select template"]')!
      expect(select).not.toBeNull()
      expect(select.value).toBe('template-one')

      // Files list on the left
      expect(container.textContent).toContain('Files')
      expect(container.textContent).toContain('index.md')

      // Page preview on the right
      expect(container.textContent).toContain('A4')
      expect(container.textContent).toContain('2 columns')
      expect(container.textContent).toContain('parchment')
      expect(container.querySelector('[data-theme="parchment"]')).not.toBeNull()

      // Footer action buttons
      expect(container.textContent).toContain('Cancelar')
      expect(container.textContent).toContain('Añadir esto al proyecto actual')
      expect(container.textContent).toContain('Reemplazar existente')

      // Changing template via select
      await act(async () => {
        select.value = 'template-two'
        select.dispatchEvent(new Event('change', { bubbles: true }))
      })

      expect(container.textContent).toContain('Template: Template Two')
      expect(container.textContent).toContain('Letter')
      expect(container.textContent).toContain('1 column')
      expect(container.textContent).toContain('modern')
      expect(container.querySelector('[data-theme="modern"]')).not.toBeNull()

      // Click Add
      const addBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Añadir esto al proyecto actual')!
      await act(async () => addBtn.click())
      expect(onApply).toHaveBeenCalledWith(template2, false)

      // Click Cancel
      const cancelBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Cancelar')!
      await act(async () => cancelBtn.click())
      expect(onClose).toHaveBeenCalled()
    } finally {
      await act(async () => root.unmount())
    }
  })

  it('renders nested subfolders and chapters in a tree structure', async () => {
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
    const packageTemplate: Template = {
      id: 'rpg-module',
      label: 'RPG Module',
      frontmatter: { pageSize: 'a4', columns: 2, theme: 'dark-fantasy' },
      body: '# Main Index',
      builtin: false,
      location: { kind: 'package', path: '/templates/rpg-module' },
    }

    fsMocks.readDir.mockImplementation(async (path: string) => {
      if (path === '/templates/rpg-module') {
        return [
          { name: 'index.md', isDirectory: false, isSymlink: false },
          { name: 'chapters', isDirectory: true, isSymlink: false },
        ]
      }
      if (path === '/templates/rpg-module/chapters') {
        return [
          { name: 'Act One', isDirectory: true, isSymlink: false },
        ]
      }
      if (path === '/templates/rpg-module/chapters/Act One') {
        return [
          { name: 'intro.md', isDirectory: false, isSymlink: false },
        ]
      }
      return []
    })

    fsMocks.readTextFile.mockImplementation(async (path: string) => {
      if (path.endsWith('intro.md')) {
        return '# Intro to Act One\n\nThe adventure starts.'
      }
      return '# Default'
    })

    const container = document.createElement('div')
    const root = createRoot(container)
    const onClose = vi.fn()
    const onApply = vi.fn()

    try {
      await act(async () => {
        root.render(
          <TemplatePreviewModal
            template={packageTemplate}
            templates={[packageTemplate]}
            hasProject={true}
            onClose={onClose}
            onApply={onApply}
          />,
        )
      })

      // Subfolders and nested chapters should be rendered
      expect(container.textContent).toContain('chapters')
      expect(container.textContent).toContain('Act One')
      expect(container.textContent).toContain('intro.md')
      expect(container.textContent).toContain('index.md')

      // Click on the nested file intro.md
      const introBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('intro.md'))!
      expect(introBtn).toBeDefined()

      await act(async () => {
        introBtn.click()
      })

      expect(fsMocks.readTextFile).toHaveBeenCalledWith('/templates/rpg-module/chapters/Act One/intro.md')
      expect(container.textContent).toContain('chapters/Act One/intro.md')
    } finally {
      await act(async () => root.unmount())
    }
  })
})
