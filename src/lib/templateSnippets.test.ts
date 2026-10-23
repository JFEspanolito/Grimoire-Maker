import { describe, expect, it } from 'vitest'
import { readTemplateSnippets } from './templateSnippets'

describe('readTemplateSnippets', () => {
  it('loads Markdown snippets from a package with labels and a collapsible group', async () => {
    const result = await readTemplateSnippets({
      readDir: async (path) => path === '/templates/my-pack'
        ? [{ name: 'snippets', isDirectory: true }]
        : [
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
      readDir: async (path) => path === '/templates/my-pack'
        ? [{ name: 'snippets', isDirectory: true }]
        : [
        { name: 'bad.md', isDirectory: false },
        { name: 'good.md', isDirectory: false },
      ],
      readTextFile: async (path) => path.endsWith('bad.md') ? Promise.reject(new Error('Unreadable')) : '# Good',
    }, '/templates/my-pack', 'my-pack', 'My Pack')

    expect(result.snippets.map((snippet) => snippet.label)).toEqual(['good'])
    expect(result.errors[0]).toContain('bad.md')
  })

  it('does not follow a symlinked snippets folder outside the package', async () => {
    const readTextFile = async () => '# Private content'
    const result = await readTemplateSnippets({
      readDir: async (path) => path === '/templates/my-pack'
        ? [{ name: 'snippets', isDirectory: true, isSymlink: true }]
        : [{ name: 'private.md', isDirectory: false }],
      readTextFile,
    }, '/templates/my-pack', 'my-pack', 'My Pack')

    expect(result.snippets).toEqual([])
    expect(result.errors[0]).toContain('symlink')
  })
})
