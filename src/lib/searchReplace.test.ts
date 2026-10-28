import { describe, expect, it } from 'vitest'
import { buildMatcher, findInText, maskProtectedSpans, MAX_MATCHES, replaceInText, type SearchOptions } from './searchReplace'

const q = (term: string, extra: Partial<SearchOptions> = {}): SearchOptions => ({ term, caseSensitive: false, ...extra })
const found = (text: string, query: SearchOptions, protect = false) => findInText(text, query, { protect }).matches.map((m) => text.slice(m.start, m.end))

describe('buildMatcher', () => {
  it('escapes plain terms and reports invalid regular expressions in plain words', () => {
    expect(buildMatcher(q('a.b(c')).regex?.test('xa.b(cx')).toBe(true)
    expect(buildMatcher(q('a.b')).regex?.test('axb')).toBe(false)
    const bad = buildMatcher(q('(', { regex: true }))
    expect(bad.regex).toBeUndefined()
    expect(bad.error).toMatch(/not valid/)
    expect(buildMatcher(q('')).error).toBe('')
  })

  it('rejects the classic catastrophic backtracking shape', () => {
    expect(buildMatcher(q('(a+)+$', { regex: true })).error).toMatch(/very slow/)
  })

  it('falls back when a pattern is valid only without the unicode flag', () => {
    expect(buildMatcher(q('\\-', { regex: true })).regex).toBeDefined()
  })
})

describe('findInText', () => {
  it('folds case with accents and non-Latin letters, or respects Match case', () => {
    expect(found('Árbol árbol ÁRBOL', q('árbol'))).toHaveLength(3)
    expect(found('Árbol árbol ÁRBOL', q('árbol', { caseSensitive: true }))).toEqual(['árbol'])
    expect(found('Привет привет', q('ПРИВЕТ'))).toHaveLength(2)
  })

  it('matches whole words next to punctuation and treats accented letters as word letters', () => {
    const query = q('cat', { wholeWord: true })
    expect(found('cat, (cat) cat. concat cats cát _cat', query)).toEqual(['cat', 'cat', 'cat'])
    expect(found('él y élite', q('él', { wholeWord: true }))).toEqual(['él'])
    expect(found('at the start cat', q('cat', { wholeWord: true }))).toEqual(['cat'])
  })

  it('supports regular expressions and never loops on zero-length matches', () => {
    expect(found('a1 b22 c333', q('\\d+', { regex: true }))).toEqual(['1', '22', '333'])
    expect(found('abc', q('x*', { regex: true }))).toEqual([])
    expect(found('ab\ncd', q('^\\w', { regex: true }))).toEqual(['a', 'c'])
    expect(found('😀😀', q('\\b', { regex: true }))).toEqual([])
  })

  it('reports an invalid regex as an error with no matches', () => {
    const result = findInText('x', q('[', { regex: true }))
    expect(result.matches).toEqual([])
    expect(result.error).toMatch(/not valid/)
  })

  it('gives 1-based lines (CRLF too) and a one-line context around the match', () => {
    const text = 'first\r\nsecond dragon here\r\nthird'
    const [match] = findInText(text, q('dragon')).matches
    expect(match.line).toBe(2)
    expect(match.context).toBe('second dragon here')
    expect(match.context.slice(match.contextStart, match.contextEnd)).toBe('dragon')
    const long = `${'x'.repeat(200)} dragon ${'y'.repeat(200)}`
    const [far] = findInText(long, q('dragon')).matches
    expect(far.context.length).toBeLessThanOrEqual(84)
    expect(far.context.slice(far.contextStart, far.contextEnd)).toBe('dragon')
    expect(far.context.startsWith('…') && far.context.endsWith('…')).toBe(true)
  })

  it('caps matches at 5000 and says it was truncated', () => {
    const result = findInText('a '.repeat(MAX_MATCHES + 50), q('a'))
    expect(result.matches).toHaveLength(MAX_MATCHES)
    expect(result.truncated).toBe(true)
    expect(findInText('a a', q('a')).truncated).toBe(false)
  })

  it('handles a huge input quickly', () => {
    const text = 'lorem ipsum dolor sit amet\n'.repeat(60000)
    const start = Date.now()
    const result = findInText(text, q('zzz'), { protect: true })
    expect(result.matches).toEqual([])
    expect(Date.now() - start).toBeLessThan(15000)
  })
})

describe('maskProtectedSpans', () => {
  const covered = (text: string, needle: string) => {
    const at = text.indexOf(needle)
    return maskProtectedSpans(text).some((span) => span.start <= at && span.end >= at + needle.length)
  }

  it('protects link and image destinations, angle forms and titles but not the link text', () => {
    const text = 'See [dragon guide](dragon.md "dragon title") and ![dragon](img/dragon.png) and [x](<my dragon.md>)'
    expect(found(text, q('dragon'), true)).toEqual(['dragon', 'dragon'])
    expect(covered(text, 'dragon.md "dragon title"')).toBe(true)
    expect(covered(text, 'img/dragon.png')).toBe(true)
    expect(covered(text, 'my dragon.md')).toBe(true)
    expect(covered(text, 'dragon guide')).toBe(false)
  })

  it('protects reference definitions, raw HTML tags, autolinks and bare URLs', () => {
    const text = '[dragon]: dragon.md\n<img src="dragon.png" alt="dragon">\n<https://dragon.example>\nVisit https://dragon.example/dragon. Done dragon.'
    expect(found(text, q('dragon'), true)).toEqual(['dragon'])
    expect(text.slice(maskProtectedSpans(text).at(-1)!.start).startsWith('https://dragon.example/dragon')).toBe(true)
  })

  it('keeps the text between HTML tags searchable', () => {
    expect(found('<div class="dragon">dragon</div>', q('dragon'), true)).toEqual(['dragon'])
  })

  it('leaves fenced and inline code searchable, even when it looks like a link', () => {
    const text = '```\n[a](dragon.md)\n```\nand `[b](dragon.md)` end'
    expect(found(text, q('dragon'), true)).toHaveLength(2)
  })

  it('works with CRLF line endings', () => {
    const text = 'a [dragon](dragon.md)\r\n\r\n[ref]: dragon.md\r\ndragon'
    expect(found(text, q('dragon'), true)).toEqual(['dragon', 'dragon'])
  })

  it('is not applied unless asked for', () => {
    expect(found('[a](dragon.md)', q('dragon'))).toEqual(['dragon'])
  })
})

describe('replaceInText', () => {
  it('replaces literally in plain mode, where $ is not special', () => {
    expect(replaceInText('cost: a a', q('a'), '$1$&')).toBe('cost: $1$& $1$&')
  })

  it('supports $1 groups, named groups and $$ only in regex mode', () => {
    const query = q('(\\w+)@(?<host>\\w+)', { regex: true })
    expect(replaceInText('me@home', query, '$2:$1:$<host>:$$:$&')).toBe('home:me:home:$:me@home')
    expect(replaceInText('ab', q('(a)', { regex: true }), '$9')).toBe('$9b')
  })

  it('replaces only the chosen matches and keeps adjacent or overlapping matches correct', () => {
    expect(replaceInText('aaaa', q('aa'), 'b')).toBe('bb')
    expect(replaceInText('x x x', q('x'), 'yy', [0, 2])).toBe('yy x yy')
    expect(replaceInText('abab', q('ab'), '', [1])).toBe('ab')
  })

  it('never touches protected spans when asked to protect', () => {
    const text = 'dragon [dragon](dragon.md) <a href="dragon">dragon</a> https://dragon.io'
    expect(replaceInText(text, q('dragon'), 'wyrm', undefined, { protect: true }))
      .toBe('wyrm [wyrm](dragon.md) <a href="dragon">wyrm</a> https://dragon.io')
  })

  it('returns the text unchanged for an invalid pattern', () => {
    expect(replaceInText('abc', q('(', { regex: true }), 'x')).toBe('abc')
  })
})
