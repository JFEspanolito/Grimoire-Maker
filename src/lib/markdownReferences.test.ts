import { describe, expect, it } from 'vitest'
import { rewriteMarkdownReferences as rewrite } from './markdownReferences'

const doc = 'C:/Book/Draft/scene.md'
const from = 'C:/Book/Assets/old map.png'
const to = 'C:/Book/Assets/new #map.png'

describe('rewriteMarkdownReferences', () => {
  it('rewrites genuine destinations without changing source formatting or titles', () => {
    const raw = '![Map](../Assets/old%20map.png?q=1#part "Title")\r\n[x](<../Assets/old map.png>)\r\n\r\n[id]: ../Assets/old%20map.png "Label"\r\n[id]\r\n'
    expect(rewrite(raw, doc, from, to)).toBe(raw.replaceAll('old%20map.png', 'new%20%23map.png').replace('old map.png', 'new%20%23map.png'))
  })

  it('preserves frontmatter, code, comments, scripts, ordinary text and unrelated URLs', () => {
    const raw = '---\r\nimage: "![x](../Assets/old%20map.png)"\r\n---\r\n' +
      '`![x](../Assets/old%20map.png)`\n```md\n![x](../Assets/old%20map.png)\n```\n' +
      '<!-- <img src="../Assets/old%20map.png"> -->\n<script>const a = \'<img src="../Assets/old%20map.png">\'</script>\n' +
      '<code><img src="../Assets/old%20map.png"></code>\n' +
      '../Assets/old%20map.png\n[x](https://host/Assets/old%20map.png)\n[x](../Other/old%20map.png)\n'
    expect(rewrite(raw, doc, from, to)).toBe(raw)
  })

  it('updates HTML attributes only, retaining quotes, case, entities and query bytes', () => {
    const raw = '<div data-src="../Assets/old%20map.png"><IMG SRC = \'../Assets/old map.png?x=1&amp;y=2#s\'><a href=../Assets/old%20map.png>Go</a></div>'
    expect(rewrite(raw, doc, from, to)).toBe('<div data-src="../Assets/old%20map.png"><IMG SRC = \'../Assets/new %23map.png?x=1&amp;y=2#s\'><a href=../Assets/new%20%23map.png>Go</a></div>')
  })

  it('matches normalized Windows paths and decoded entities and escaped punctuation', () => {
    expect(rewrite('[x](../assets/./OLD%20MAP.png)', doc.replaceAll('/', '\\'), from, to)).toBe('[x](../assets/./new%20%23map.png)')
    expect(rewrite('[x](../Assets/a\\(b\\).png) <img src="../Assets/a&#40;b&#41;.png">', doc, 'C:/Book/Assets/a(b).png', to)).toBe('[x](../Assets/new%20%23map.png) <img src="../Assets/new %23map.png">')
    expect(rewrite('[x](../Assets/a%23b.png#keep)', doc, 'C:/Book/Assets/a#b.png', to)).toBe('[x](../Assets/new%20%23map.png#keep)')
  })

  it('supports absolute local paths and file URLs but not remote authorities', () => {
    const raw = '[x](C:/Book/Assets/old%20map.png) [y](file:///C:/Book/Assets/old%20map.png) [z](//host/old%20map.png)'
    expect(rewrite(raw, doc, from, to)).toBe('[x](C:/Book/Assets/new%20%23map.png) [y](file:///C:/Book/Assets/new%20%23map.png) [z](//host/old%20map.png)')
  })

  it('does not rebase other assets when the source document itself is renamed', () => {
    const raw = '![x](../Assets/old%20map.png) [self](scene.md#here)'
    expect(rewrite(raw, doc, doc, 'C:/Book/Draft/new.md')).toBe('![x](../Assets/old%20map.png) [self](new.md#here)')
  })

  it('rejects directory moves rather than guessing a reference rebase', () => {
    expect(() => rewrite('', doc, from, 'C:/Book/Other/new.png')).toThrow(/same parent/i)
  })

  it('keeps quoted HTML spaces literal and escapes filename delimiters', () => {
    const target = 'C:/Book/Assets/new & 100% # "map\'.png'
    expect(rewrite('<img src="../Assets/old%20map.png?q=1&amp;y=2#s">', doc, from, target))
      .toBe('<img src="../Assets/new &amp; 100%25 %23 &quot;map&#39;.png?q=1&amp;y=2#s">')
    // CommonMark only treats an unquoted-attribute tag as HTML inside an HTML block.
    expect(rewrite('<div><a href=../Assets/old%20map.png>Go</a></div>', doc, from, 'C:/Book/Assets/new map.png'))
      .toBe('<div><a href=../Assets/new%20map.png>Go</a></div>')
  })

  it('does not mistake a leading thematic break for unclosed frontmatter', () => {
    expect(rewrite('---\n\n![x](../Assets/old%20map.png)', doc, from, to))
      .toBe('---\n\n![x](../Assets/new%20%23map.png)')
  })

  it('keeps offsets aligned for files starting with a BOM', () => {
    expect(rewrite('﻿# T\n![x](../Assets/old%20map.png)\n', doc, from, to))
      .toBe('﻿# T\n![x](../Assets/new%20%23map.png)\n')
    expect(rewrite('﻿<img src="../Assets/old%20map.png">', doc, from, to))
      .toBe('﻿<img src="../Assets/new %23map.png">')
  })

  it('protects inline script/code contents even when Markdown parses their inner text', () => {
    const raw = 'Hello <script>"[x](../Assets/old%20map.png)"</script> and <code>[x](../Assets/old%20map.png)</code>.'
    expect(rewrite(raw, doc, from, to)).toBe(raw)
  })

  it('preserves invalid and remote destinations, and supports encoded separators', () => {
    const raw = '[x](../Assets/old%XXmap.png) [x](file://server/Assets/old%20map.png) [x](#old%20map.png)'
    expect(rewrite(raw, doc, from, to)).toBe(raw)
    expect(rewrite('[x](../Assets%2Fold%20map.png)', doc, from, to)).toBe('[x](../Assets%2Fnew%20%23map.png)')
  })
})
