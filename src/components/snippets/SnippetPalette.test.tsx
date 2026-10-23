import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { OFFICIAL_TEMPLATES } from '../../lib/templates'
import { useTemplateStore } from '../../stores/templateStore'
import { SNIPPET_GROUPS, SNIPPETS } from './snippets'
import { SnippetPalette } from './SnippetPalette'

let root: Root | null = null
beforeAll(() => Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true))
afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = null
  useTemplateStore.setState({ templates: OFFICIAL_TEMPLATES })
})

describe('snippet palette', () => {
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
