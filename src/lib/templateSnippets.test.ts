import { describe, expect, it } from 'vitest'
import { readTemplateSnippets } from './templateSnippets'

describe('readTemplateSnippets', () => {
  it('loads Markdown snippets from a package with labels and a collapsible group', async () => {
    const result = await readTemplateSnippets({
      exists: async () => true,
      readDir: async () => [
        { name: 'encounter.md', isDirectory: false },
        { name: 'notes.txt', isDirectory: false },
      ],
      readTextFile: async () => '---\nsnippetName: Random encounter\n---\n## Encounter\n\nRoll 1d6.\n',
    }, '/templates/my-pack', 'my-pack', 'My Pack')

    expect(result.errors).toEqual([])
    expect(result.snippets).toEqual([{
      id: 'my-pack/encounter', label: 'Random encounter', group: 'My Pack',
      markdown: '## Encounter\n\nRoll 1d6.\n',
    }])
  })

  it('reports a broken snippet without hiding the other package snippets', async () => {
    const result = await readTemplateSnippets({
      exists: async () => true,
      readDir: async () => [
        { name: 'bad.md', isDirectory: false },
        { name: 'good.md', isDirectory: false },
      ],
      readTextFile: async (path) => path.endsWith('bad.md') ? Promise.reject(new Error('Unreadable')) : '# Good',
    }, '/templates/my-pack', 'my-pack', 'My Pack')

    expect(result.snippets.map((snippet) => snippet.label)).toEqual(['good'])
    expect(result.errors[0]).toContain('bad.md')
  })
})
