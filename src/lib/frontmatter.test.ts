import { describe, expect, it } from 'vitest'
import { parseDocument, serializeDocument } from './frontmatter'

describe('quoted frontmatter scalars', () => {
  it.each(['He said "hi"', 'C:\\x\\chapter.md', "O'Brien", 'Line\nTab\tValue', '\\'])('keeps %j stable across repeated saves', (title) => {
    let raw = serializeDocument({ title }, '# Chapter')
    for (let save = 0; save < 4; save++) {
      const document = parseDocument(raw)
      expect(document).toEqual({ frontmatter: { title }, body: '# Chapter' })
      raw = serializeDocument(document.frontmatter, document.body)
    }
  })
  it('decodes doubled apostrophes in single quotes without unescaping backslashes', () => {
    expect(parseDocument("---\ntitle: 'It''s C:\\x'\n---\nBody").frontmatter.title).toBe("It's C:\\x")
  })
  it('preserves the existing flat scalar and plain-document behavior', () => {
    const raw = '---\ntitle: Chapter 1\ncolumns: 2\nenabled: true\n---\n# Body'
    expect(parseDocument(raw)).toEqual({ frontmatter: { title: 'Chapter 1', columns: 2, enabled: true }, body: '# Body' })
    expect(parseDocument('# Plain')).toEqual({ frontmatter: {}, body: '# Plain' })
  })
})
