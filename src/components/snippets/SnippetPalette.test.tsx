import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SNIPPET_GROUPS, SNIPPETS } from './snippets'
import { SnippetPalette } from './SnippetPalette'

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
})
