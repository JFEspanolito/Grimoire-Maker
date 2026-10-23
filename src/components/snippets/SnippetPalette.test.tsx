import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { OFFICIAL_TEMPLATES } from '../../lib/templates'
import { useTemplateStore } from '../../stores/templateStore'
import { useModStore } from '../../stores/modStore'
import { SNIPPET_GROUPS, SNIPPETS } from './snippets'
import { SnippetPalette } from './SnippetPalette'
import { Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'

let root: Root | null = null
beforeAll(() => Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true))
afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = null
  useTemplateStore.setState({ templates: OFFICIAL_TEMPLATES })
  useModStore.setState({ ready: false, snippets: [] })
})

describe('snippet palette', () => {
  it('still inserts a Markdown snippet at the cursor on double-click', async () => {
    useModStore.setState({ ready: true, snippets: [{ id: 'note', label: 'Note', group: 'Notes', markdown: '## Inserted note' }] })
    const editor = new Editor({ extensions: [StarterKit, Markdown], content: '<p>First</p><p>Last</p>',
      editorProps: { handleScrollToSelection: () => true } })
    editor.commands.setTextSelection(8)
    const container = document.createElement('div')
    root = createRoot(container)
    try {
      await act(async () => root?.render(<SnippetPalette editor={editor} />))
      await act(async () => container.querySelector('button')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
      expect(editor.getHTML()).toBe('<p>First</p><h2>Inserted note</h2><p>Last</p>')
    } finally { await act(async () => root?.unmount()); root = null; editor.destroy() }
  })
  it('uses the enabled folder catalog without restoring disabled built-in examples', async () => {
    useModStore.setState({ ready: true, snippets: [] })
    const container = document.createElement('div')
    root = createRoot(container)
    await act(async () => root?.render(<SnippetPalette editor={null} />))
    expect(container.querySelectorAll('details')).toHaveLength(0)
    await act(async () => useModStore.setState({ snippets: [{ id: 'mod:my/one', label: 'Custom note', group: 'My Notes', markdown: '# Note' }] }))
    expect(container.querySelector('summary')?.textContent).toContain('My Notes')
    expect(container.querySelector('button')?.textContent).toBe('Custom note')
  })
  it('renders each group as an initially expanded, collapsible section', () => {
    const container = document.createElement('div')
    container.innerHTML = renderToStaticMarkup(<SnippetPalette editor={null} />)

    const groups = Array.from(container.querySelectorAll('details'))
    expect(groups).toHaveLength(SNIPPET_GROUPS.length)

    groups.forEach((group, index) => {
      const name = SNIPPET_GROUPS[index]
      const summary = group.querySelector('summary')
      expect(summary?.textContent).toContain(name)
      expect(group.open).toBe(true)
      expect(group.querySelectorAll('button')).toHaveLength(SNIPPETS.filter((snippet) => snippet.group === name).length)

      summary?.click()
      expect(group.open).toBe(false)
      summary?.click()
      expect(group.open).toBe(true)
    })
  })

  it('adds imported Markdown snippets under a collapsible package group', async () => {
    useTemplateStore.setState({ templates: [...OFFICIAL_TEMPLATES, {
      id: 'custom', label: 'Custom', builtin: false, frontmatter: {}, body: '# Start',
      snippets: [{ id: 'custom/encounter', label: 'Encounter', group: 'Custom', markdown: '## Encounter' }],
    }] })
    const container = document.createElement('div')
    root = createRoot(container)
    await act(async () => root?.render(<SnippetPalette editor={null} />))

    const custom = Array.from(container.querySelectorAll('details')).find((group) =>
      group.querySelector('summary')?.textContent?.includes('Custom'))
    expect(custom?.querySelector('button')?.textContent).toBe('Encounter')
    expect(custom?.open).toBe(true)
    custom?.querySelector('summary')?.click()
    expect(custom?.open).toBe(false)
  })
})
