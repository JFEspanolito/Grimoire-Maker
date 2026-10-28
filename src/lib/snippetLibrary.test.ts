import { describe, expect, it, vi } from 'vitest'
import { parseDocument } from './frontmatter'
import type { ModFs } from './modCatalog'
import {
  buildSnippetFile,
  firstSnippetTag,
  normalizeSnippetMarkdown,
  readSnippetsById,
  saveSnippetToLibrary,
} from './snippetLibrary'

vi.mock('@tauri-apps/plugin-fs', () => ({}))
vi.mock('./preferences', () => ({ loadLibraryPaths: async () => ({ snippets: '/Mods/Snippets' }) }))

interface Entry { name: string; isDirectory: boolean; isSymlink?: boolean }

/** An in-memory ModFs; `links` lists paths that behave as symbolic links. */
function memoryFs(initial: Record<string, string> = {}, links: string[] = []) {
  const files = new Map<string, string>(Object.entries(initial))
  const folders = new Set<string>(['/Mods/Snippets'])
  for (const path of [...files.keys(), ...links]) {
    for (let at = path.lastIndexOf('/'); at > 0; at = path.lastIndexOf('/', at - 1)) folders.add(path.slice(0, at))
  }
  for (const link of links) if (!files.has(link)) folders.add(link)
  const fs: ModFs = {
    exists: async (path) => files.has(path) || folders.has(path),
    mkdir: async (path) => { folders.add(path) },
    readDir: async (path) => {
      const out: Entry[] = []
      for (const folder of folders) if (folder.slice(0, folder.lastIndexOf('/')) === path) out.push({ name: folder.slice(path.length + 1), isDirectory: true, isSymlink: links.includes(folder) })
      for (const file of files.keys()) if (file.slice(0, file.lastIndexOf('/')) === path) out.push({ name: file.slice(path.length + 1), isDirectory: false, isSymlink: links.includes(file) })
      return out
    },
    readTextFile: async (path) => {
      const text = files.get(path)
      if (text === undefined) throw new Error(`missing ${path}`)
      return text
    },
    stat: async (path) => ({ size: (files.get(path) ?? '').length }),
    writeTextFile: async (path, text) => {
      if (files.has(path)) throw new Error('already exists')
      files.set(path, text)
    },
  }
  return { fs, files, folders }
}

const STATBLOCK = '<div data-type="statblock">\n\n### Goblin\n\n- AC 15\n- HP 7\n\n</div>'
const TABLE = '| d6 | Encounter |\n| --- | --- |\n| 1 | Wolves |\n| 2 | Bandits |'

describe('normalizeSnippetMarkdown', () => {
  it('removes section breaks and unwraps content boxes, keeping everything inside them', () => {
    const input = [
      '<div data-type="section-break" data-columns="2" data-auto="true"></div>',
      '',
      '<div data-type="standard-content-box" data-placement="free" data-width-mm="80" data-x-mm="10" style="width:80mm;position:absolute;left:10mm;top:0mm;"><p>Boxed <strong>text</strong></p><div data-type="statblock"><p>Inner</p></div></div>',
      '',
      '## Heading',
    ].join('\n')
    const out = normalizeSnippetMarkdown(input)
    expect(out).not.toContain('section-break')
    expect(out).not.toContain('standard-content-box')
    expect(out).not.toContain('data-width-mm')
    expect(out).not.toContain('position:absolute')
    expect(out).toContain('<p>Boxed <strong>text</strong></p>')
    expect(out).toContain('<div data-type="statblock"><p>Inner</p></div>')
    expect(out).toContain('## Heading')
  })

  it('keeps tables, lists, headings, read-aloud and statblock blocks untouched', () => {
    const input = `# Title\n\n${TABLE}\n\n${STATBLOCK}\n\n<div data-type="read-aloud">\n\nThe door creaks.\n\n</div>\n\n1. one\n2. two`
    expect(normalizeSnippetMarkdown(input)).toBe(`${input}\n`)
  })

  it('removes page-layout attributes from images but keeps source, text and frame', () => {
    const input = '<img src="a b.png" alt="Map" title="T" data-align="left" data-width-mm="90" data-frame="simple" data-opacity="0.5" data-anchor="free" data-x-mm="3" data-y-mm="4" style="width:90mm" />'
    const out = normalizeSnippetMarkdown(input)
    expect(out).toBe('<img src="a b.png" alt="Map" title="T" data-frame="simple" data-opacity="0.5" />\n')
  })

  it('drops a leading frontmatter block (page columns, size, theme) and normalizes line endings', () => {
    expect(normalizeSnippetMarkdown('---\r\ncolumns: 2\r\npageSize: a4\r\n---\r\nText\r\n\r\n\r\n\r\nMore')).toBe('Text\n\nMore\n')
  })

  it('does not touch code', () => {
    const input = '```html\n<div data-type="section-break" data-columns="2"></div>\n\n\n\nx\n```\n\nInline `<div data-type="standard-content-box">` stays.'
    expect(normalizeSnippetMarkdown(input)).toBe(`${input}\n`)
  })

  it('is idempotent', () => {
    const input = [
      '---\ncolumns: 2\n---',
      '<div data-type="section-break" data-columns="1"></div>',
      '<div data-type="standard-content-box" data-border-width="2"><p>x</p></div>',
      '<img src="a.png" data-anchor="background" data-x-mm="1" />',
      TABLE,
      '```\n<div data-type="section-break"></div>\n```',
    ].join('\n\n\n\n')
    const once = normalizeSnippetMarkdown(input)
    expect(normalizeSnippetMarkdown(once)).toBe(once)
  })

  it('returns an empty string for whitespace only', () => {
    expect(normalizeSnippetMarkdown('\n  \n')).toBe('')
  })
})

describe('buildSnippetFile', () => {
  it('writes the spec shape: snippetName, optional author, tags, then the body', () => {
    const file = buildSnippetFile({ name: 'Encounter Table (d6)', category: 'Dungeons and Dragons', author: 'JF', markdown: TABLE })
    expect(file.fileName).toBe('Encounter-Table-d6.md')
    expect(file.category).toBe('Dungeons and Dragons')
    expect(file.content).toBe(`---\nsnippetName: Encounter Table (d6)\nauthor: JF\ntags: [Dungeons and Dragons]\n---\n${TABLE}\n`)
    const { frontmatter, body } = parseDocument(file.content)
    expect(frontmatter.snippetName).toBe('Encounter Table (d6)')
    expect(body).toBe(`${TABLE}\n`)
  })

  it('omits the author line when there is no author', () => {
    expect(buildSnippetFile({ name: 'A', category: 'B', markdown: 'x' }).content).toBe('---\nsnippetName: A\ntags: [B]\n---\nx\n')
  })

  it('falls back to General and snippet, and refuses an empty body', () => {
    const file = buildSnippetFile({ name: '  ', category: '///', markdown: 'x' })
    expect(file.fileName).toBe('snippet.md')
    expect(file.category).toBe('General')
    expect(() => buildSnippetFile({ name: 'A', category: 'B', markdown: '  \n' })).toThrow(/no content/)
  })

  it.each([
    ['a newline and a new key', 'Goblin\ninjected: true'],
    ['a frontmatter fence', 'x\n---\ninjected: true'],
    ['a colon and a comment', 'Goblin: the #1 one'],
    ['quotes', `He said "hi" and 'bye'`],
    ['a leading dash and brackets', '- [x] {y}'],
    ['a number', '2024'],
    ['a boolean', 'true'],
    ['a backslash', 'C:\\Users\\me'],
    ['line separators', 'a\u2028b\u2029c'],
  ])('keeps hostile text in the name or author on one line (%s)', (_label, text) => {
    const file = buildSnippetFile({ name: text, category: 'Cat', author: text, markdown: 'body' })
    const { frontmatter, body } = parseDocument(file.content)
    expect(Object.keys(frontmatter)).toEqual(['snippetName', 'author', 'tags'])
    expect(body).toBe('body\n')
    expect(file.content.split('\n')[0]).toBe('---')
    expect(file.content.split('\n').filter((line) => line === '---')).toHaveLength(2)
    expect(file.content).not.toMatch(/^injected:/m)
  })

  it.each(['../../etc/passwd', '..\\..\\Windows', 'C:\\x', 'CON', 'nul', 'a/b/c', '\u202ecod.md', 'zero\u200bwidth', '.hidden', '   ...   '])(
    'turns the hostile name or category %j into a single safe path segment',
    (hostile) => {
      const file = buildSnippetFile({ name: hostile, category: hostile, markdown: 'x' })
      for (const segment of [file.fileName.replace(/\.md$/, ''), file.category]) {
        expect(segment).not.toMatch(/[\\/:.]|[\u200b-\u200f\u202a-\u202e\u2066-\u2069]/)
        expect(segment).not.toMatch(/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i)
        expect(segment.length).toBeGreaterThan(0)
      }
    },
  )

  it('refuses a snippet over 512 KiB', () => {
    expect(() => buildSnippetFile({ name: 'Big', category: 'C', markdown: 'x'.repeat(600 * 1024) })).toThrow(/512 KiB/)
  })

  it('quotes the category tag when needed and still round-trips its first tag', () => {
    const file = buildSnippetFile({ name: 'A', category: 'Rules & Magic (5e)', markdown: 'x' })
    expect(file.category).toBe('Rules Magic (5e)')
    expect(firstSnippetTag(parseDocument(file.content).frontmatter)).toBe('Rules Magic (5e)')
  })
})

describe('firstSnippetTag', () => {
  it.each([
    ['[Dungeons and Dragons]', 'Dungeons and Dragons'],
    ['[A, B]', 'A'],
    ["['Quoted one', B]", 'Quoted one'],
    ['["Two", B]', 'Two'],
    ['Plain', 'Plain'],
    ['[]', null],
  ])('reads %s', (raw, expected) => {
    expect(firstSnippetTag({ tags: raw })).toBe(expected)
  })

  it('is null without tags', () => {
    expect(firstSnippetTag({})).toBeNull()
    expect(firstSnippetTag({ tags: 5 })).toBeNull()
  })
})

describe('saveSnippetToLibrary', () => {
  it('writes Snippets/<Category>/<Name>.md in the configured library and returns the path', async () => {
    const { fs, files } = memoryFs()
    const { path } = await saveSnippetToLibrary({ name: 'Goblin Ambush', category: 'Monsters', markdown: 'Text' }, fs)
    expect(path).toBe('/Mods/Snippets/Monsters/Goblin-Ambush.md')
    expect(files.get(path)).toContain('snippetName: Goblin Ambush')
  })

  it('never overwrites: a taken name gets -2, -3', async () => {
    const { fs, files } = memoryFs()
    const input = { name: 'Goblin', category: 'Monsters', markdown: 'Text' }
    expect((await saveSnippetToLibrary(input, fs)).path).toBe('/Mods/Snippets/Monsters/Goblin.md')
    expect((await saveSnippetToLibrary(input, fs)).path).toBe('/Mods/Snippets/Monsters/Goblin-2.md')
    expect((await saveSnippetToLibrary({ ...input, name: 'goblin' }, fs)).path).toBe('/Mods/Snippets/Monsters/goblin-3.md')
    expect(files.size).toBe(3)
  })

  it('reuses an existing category folder ignoring case', async () => {
    const { fs } = memoryFs({ '/Mods/Snippets/monsters/Old.md': 'x' })
    const { path } = await saveSnippetToLibrary({ name: 'New', category: 'MONSTERS', markdown: 'Text' }, fs)
    expect(path).toBe('/Mods/Snippets/monsters/New.md')
  })

  it('refuses a category folder that is a link', async () => {
    const { fs } = memoryFs({}, ['/Mods/Snippets/Monsters'])
    await expect(saveSnippetToLibrary({ name: 'New', category: 'Monsters', markdown: 'Text' }, fs)).rejects.toThrow(/not a link/)
  })

  it('moves on when another process takes the name first (exclusive create)', async () => {
    const { fs, files } = memoryFs()
    const write = fs.writeTextFile
    let raced = false
    fs.writeTextFile = async (path, text) => {
      if (!raced) { raced = true; files.set(path, 'someone else'); throw new Error('exists') }
      return write(path, text)
    }
    const { path } = await saveSnippetToLibrary({ name: 'Race', category: 'C', markdown: 'x' }, fs)
    expect(path).toBe('/Mods/Snippets/C/Race-2.md')
    expect(files.get('/Mods/Snippets/C/Race.md')).toBe('someone else')
  })

  it('stays inside the Snippets folder for hostile categories', async () => {
    const { fs } = memoryFs()
    const { path } = await saveSnippetToLibrary({ name: '../x', category: '..\\..\\Windows', markdown: 'x' }, fs)
    expect(path.startsWith('/Mods/Snippets/')).toBe(true)
    expect(path).not.toContain('..')
  })
})

describe('readSnippetsById', () => {
  const library = {
    '/Mods/Snippets/Monsters/Goblin.md': '---\nsnippetName: Goblin Boss\nauthor: JF\ntags: [Monsters]\n---\nStats\n',
    '/Mods/Snippets/Monsters/sub/Deep.md': 'No frontmatter\n',
    '/Mods/Snippets/Monsters/Link.md': 'linked',
    '/Mods/Snippets/Monsters/notes.txt': 'not a snippet',
  }

  it('re-reads snippets from the library by catalog id', async () => {
    const { fs } = memoryFs(library)
    const read = await readSnippetsById(['mod:Snippets/monsters/Goblin.md', 'mod:Snippets/monsters/sub/Deep.md'], fs, '/Mods/Snippets')
    expect(read).toEqual([
      { name: 'Goblin Boss', category: 'Monsters', author: 'JF', markdown: 'Stats\n' },
      { name: 'Deep', category: 'Monsters', author: undefined, markdown: 'No frontmatter\n' },
    ])
  })

  it.each([
    'mod:Snippets/monsters/../../secret.md',
    'mod:Snippets/monsters/missing.md',
    'mod:Snippets/other/Goblin.md',
    'mod:Snippets/monsters/notes.txt',
    'mod:Snippets/monsters/Link.md',
    'mod:Templates/monsters/Goblin.md',
    'C:/Windows/win.ini',
    '',
  ])('refuses the id %j', async (id) => {
    const { fs } = memoryFs(library, ['/Mods/Snippets/Monsters/Link.md'])
    await expect(readSnippetsById([id], fs, '/Mods/Snippets')).rejects.toThrow()
  })

  it('refuses an empty selection', async () => {
    const { fs } = memoryFs(library)
    await expect(readSnippetsById([], fs, '/Mods/Snippets')).rejects.toThrow(/at least one/)
  })
})
