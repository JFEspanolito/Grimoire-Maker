import { fromMarkdown } from 'mdast-util-from-markdown'

/** What the user typed in the Find panel. Shared by the editor highlight and the project search. */
export interface SearchOptions {
  term: string
  caseSensitive: boolean
  wholeWord?: boolean
  regex?: boolean
}

export interface Span { start: number; end: number }

/** Matches per search; more than this is reported as "too many" instead of freezing the app. */
export const MAX_MATCHES = 5000

export type Matcher = { regex: RegExp; error?: undefined } | { regex?: undefined; error: string }

export const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Letters, digits, combining marks and underscore: whole-word boundaries that work with accents.
const WORD = '[\\p{L}\\p{N}\\p{M}_]'
// Used only when a user pattern is not valid under the `u` flag.
const LEGACY_WORD = '[A-Za-z0-9_\\u00C0-\\u024F\\u0370-\\u1FFF]'
// A quantified group that itself contains a quantifier, such as (a+)+: the classic catastrophic backtracking shape.
const NESTED_QUANTIFIERS = /\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)[+*]/

function plainError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const reason = message.slice(message.lastIndexOf(': ') + 2)
  return `The regular expression is not valid (${reason}).`
}

/** Builds the global regular expression for a query. An empty term returns an empty error text. */
export function buildMatcher(query: SearchOptions): Matcher {
  if (!query.term) return { error: '' }
  const source = query.regex ? query.term : escapeRegExp(query.term)
  if (query.regex && NESTED_QUANTIFIERS.test(source)) return { error: 'This pattern could make the search very slow. Try a simpler one.' }
  const flags = `g${query.caseSensitive ? '' : 'i'}${query.regex ? 'm' : ''}`
  const build = (unicode: boolean) => {
    const word = unicode ? WORD : LEGACY_WORD
    const body = query.wholeWord ? `(?<!${word})(?:${source})(?!${word})` : source
    return new RegExp(body, unicode ? `${flags}u` : flags)
  }
  try {
    return { regex: build(true) }
  } catch (unicodeError) {
    if (!query.regex) return { error: plainError(unicodeError) }
    try { return { regex: build(false) } } catch (error) { return { error: plainError(error) } }
  }
}

export interface RawMatch { start: number; end: number; groups: RegExpExecArray }

/** Order of the spans decides nothing here: they are sorted and merged so overlap checks can walk once. */
function normalizeSpans(spans: Span[]): Span[] {
  const sorted = spans.filter((span) => span.end > span.start).sort((a, b) => a.start - b.start || a.end - b.end)
  const merged: Span[] = []
  for (const span of sorted) {
    const last = merged[merged.length - 1]
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end)
    else merged.push({ ...span })
  }
  return merged
}

/**
 * Every non-empty, non-protected match in order. A match that touches a protected span is skipped whole.
 * Zero-length matches are skipped and the search always moves forward.
 */
export function scanText(text: string, regex: RegExp, { cap = Infinity, protect = [] }: { cap?: number; protect?: Span[] } = {}): { matches: RawMatch[]; truncated: boolean } {
  const spans = normalizeSpans(protect)
  const matches: RawMatch[] = []
  let pointer = 0
  regex.lastIndex = 0
  for (let found = regex.exec(text); found; found = regex.exec(text)) {
    const start = found.index
    const end = start + found[0].length
    if (end === start) {
      const code = text.codePointAt(start)
      regex.lastIndex = start + (code !== undefined && code > 0xffff && regex.unicode ? 2 : 1)
      if (regex.lastIndex > text.length) break
      continue
    }
    while (pointer < spans.length && spans[pointer].end <= start) pointer++
    if (pointer < spans.length && spans[pointer].start < end) { regex.lastIndex = end; continue }
    if (matches.length >= cap) return { matches, truncated: true }
    matches.push({ start, end, groups: found })
  }
  return { matches, truncated: false }
}

/* ---- Protected spans (Project scope) -------------------------------------------------------- */

const HTML_TAG = /<\/?[A-Za-z][A-Za-z0-9-]*(?:"[^"]*"|'[^']*'|[^<>"'])*>|<!--[\s\S]*?-->/g
const BARE_URL = /(?:\b(?:https?|ftp):\/\/|\bwww\.)[^\s<>]+/gi
const CODE_TOKENS = new Set(['codeFenced', 'codeIndented', 'codeText'])
const PROTECTED_TOKENS = new Set(['resource', 'definition', 'autolink', 'reference'])

function trimUrl(url: string): string {
  let end = url.length
  for (;;) {
    const last = url[end - 1]
    const opens = url.slice(0, end).split('(').length - 1
    const closes = url.slice(0, end).split(')').length - 1
    if (last && /[.,;:!?'"*_\]}]/.test(last) || (last === ')' && closes > opens)) end--
    else return url.slice(0, end)
  }
}

/**
 * Where Project replace must not touch the Markdown body: link and image destinations with their titles,
 * reference definitions and labels, raw HTML tags, autolinks and bare URLs. Fenced and inline code stay
 * searchable. Pass the body only: the frontmatter is not part of it.
 */
export function maskProtectedSpans(body: string): Span[] {
  const spans: Span[] = []
  const code: Span[] = []
  try {
    fromMarkdown(body, { mdastExtensions: [{ afterExit(token) {
      const range = { start: token.start.offset, end: token.end.offset }
      if (CODE_TOKENS.has(token.type)) code.push(range)
      else if (PROTECTED_TOKENS.has(token.type)) spans.push(range)
      else if (token.type === 'htmlFlow' || token.type === 'htmlText') {
        for (const tag of body.slice(range.start, range.end).matchAll(HTML_TAG)) spans.push({ start: range.start + tag.index, end: range.start + tag.index + tag[0].length })
      }
    } }] })
  } catch {
    // Unreadable Markdown: protect everything rather than risk a broken link.
    return [{ start: 0, end: body.length }]
  }
  const inCode = (at: number) => code.some((range) => at >= range.start && at < range.end)
  for (const url of body.matchAll(BARE_URL)) {
    if (inCode(url.index)) continue
    const trimmed = trimUrl(url[0])
    spans.push({ start: url.index, end: url.index + trimmed.length })
  }
  return normalizeSpans(spans)
}

/* ---- Finding -------------------------------------------------------------------------------- */

export interface TextMatch extends Span {
  /** 1-based line of the match start. */
  line: number
  /** One-line excerpt (about 80 characters) that contains the match. */
  context: string
  /** Where the match sits inside `context`. */
  contextStart: number
  contextEnd: number
}

export interface FindResult { matches: TextMatch[]; truncated: boolean; error?: string }

const EXCERPT = 80

function lineStarts(text: string): number[] {
  const starts = [0]
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) starts.push(at + 1)
  return starts
}

function lineIndex(starts: number[], offset: number): number {
  let low = 0
  let high = starts.length - 1
  while (low < high) {
    const middle = (low + high + 1) >> 1
    if (starts[middle] <= offset) low = middle
    else high = middle - 1
  }
  return low
}

function describe(text: string, starts: number[], raw: RawMatch): TextMatch {
  const index = lineIndex(starts, raw.start)
  const lineStart = starts[index]
  let lineEnd = index + 1 < starts.length ? starts[index + 1] - 1 : text.length
  if (text[lineEnd - 1] === '\r') lineEnd--
  const matchEnd = Math.min(raw.end, lineEnd)
  let from = lineStart
  let to = lineEnd
  if (lineEnd - lineStart > EXCERPT) {
    from = Math.max(lineStart, Math.min(raw.start - 25, lineEnd - EXCERPT))
    to = Math.min(lineEnd, from + EXCERPT)
  }
  const prefix = from > lineStart ? '…' : ''
  const suffix = to < lineEnd ? '…' : ''
  const contextStart = prefix.length + raw.start - from
  const contextEnd = prefix.length + Math.min(matchEnd, to) - from
  return { start: raw.start, end: raw.end, line: index + 1, context: `${prefix}${text.slice(from, to)}${suffix}`, contextStart, contextEnd }
}

/** Finds matches in plain text; `protect` skips links, images, HTML and URLs (Project scope). */
export function findInText(text: string, query: SearchOptions, { protect = false }: { protect?: boolean } = {}): FindResult {
  const matcher = buildMatcher(query)
  if (!matcher.regex) return { matches: [], truncated: false, error: matcher.error || undefined }
  const { matches, truncated } = scanText(text, matcher.regex, { cap: MAX_MATCHES, protect: protect ? maskProtectedSpans(text) : [] })
  const starts = lineStarts(text)
  return { matches: matches.map((match) => describe(text, starts, match)), truncated }
}

/* ---- Replacing ------------------------------------------------------------------------------ */

/** Regex mode: `$1`, `$&`, `$<name>` and `$$` work like String.replace. */
export function expandReplacement(replacement: string, found: RegExpExecArray): string {
  return replacement.replace(/\$(\$|&|\d{1,2}|<[^>]*>)/g, (whole, token: string) => {
    if (token === '$') return '$'
    if (token === '&') return found[0]
    if (token.startsWith('<')) return found.groups?.[token.slice(1, -1)] ?? ''
    const groupCount = found.length - 1
    if (token.length === 2 && Number(token) > groupCount) {
      const single = Number(token[0])
      return single >= 1 && single <= groupCount ? (found[single] ?? '') + token[1] : whole
    }
    const number = Number(token)
    return number >= 1 && number <= groupCount ? (found[number] ?? '') : whole
  })
}

/**
 * Replaces matches (all of them, or only those whose position in `findInText`'s list is in `only`).
 * Plain mode replaces literally. Protected spans (when `protect`) are never touched.
 */
export function replaceInText(text: string, query: SearchOptions, replacement: string, only?: Iterable<number>, { protect = false }: { protect?: boolean } = {}): string {
  const matcher = buildMatcher(query)
  if (!matcher.regex) return text
  const { matches } = scanText(text, matcher.regex, { protect: protect ? maskProtectedSpans(text) : [] })
  const chosen = only ? new Set(only) : null
  let output = ''
  let cursor = 0
  matches.forEach((match, index) => {
    if (chosen && !chosen.has(index)) return
    output += text.slice(cursor, match.start) + (query.regex ? expandReplacement(replacement, match.groups) : replacement)
    cursor = match.end
  })
  return output + text.slice(cursor)
}
