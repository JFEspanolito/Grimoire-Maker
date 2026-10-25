const WORDS_PER_PAGE = 300
const WORDS_PER_MINUTE = 238
const TOP_WORDS = 10

export interface WordFrequency { word: string; count: number; share: number }
export interface DocumentStatistics {
  words: number
  characters: number
  charactersNoSpaces: number
  paragraphs: number
  sentences: number
  averageParagraphLength: number
  averageSentenceLength: number
  documents: number
  averageDocumentLength: number
  longestDocument: number
  shortestDocument: number
  pages: number
  readingSeconds: number
  frequency: WordFrequency[]
}

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu

/** Drops Markdown syntax so only the prose a reader sees is counted. */
function plainText(markdown: string) {
  return markdown
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/^\s*(?:[-*_]\s*){3,}$/gm, '')
    .replace(/[*_`~]/g, '')
}

const wordsOf = (text: string) => text.match(WORD) ?? []
const average = (total: number, count: number) => count ? Math.round(total / count) : 0

export function computeStatistics(bodies: readonly string[]): DocumentStatistics {
  const counts = new Map<string, number>()
  const lengths: number[] = []
  let characters = 0, charactersNoSpaces = 0, paragraphs = 0, sentences = 0
  for (const body of bodies) {
    const text = plainText(body)
    const words = wordsOf(text)
    lengths.push(words.length)
    for (const word of words) { const key = word.toLowerCase(); counts.set(key, (counts.get(key) ?? 0) + 1) }
    const flat = text.replace(/[\r\n]/g, '')
    characters += flat.length
    charactersNoSpaces += flat.replace(/\s/g, '').length
    paragraphs += text.split(/\r?\n/).filter((line) => wordsOf(line).length).length
    sentences += text.split(/[.!?…]+(?:\s|$)|\r?\n/).filter((part) => wordsOf(part).length).length
  }
  const words = lengths.reduce((sum, length) => sum + length, 0)
  const ranked = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, TOP_WORDS)
  const top = ranked[0]?.[1] ?? 1
  return {
    words, characters, charactersNoSpaces, paragraphs, sentences,
    averageParagraphLength: average(words, paragraphs),
    averageSentenceLength: average(words, sentences),
    documents: bodies.length,
    averageDocumentLength: average(words, bodies.length),
    longestDocument: lengths.length ? Math.max(...lengths) : 0,
    shortestDocument: lengths.length ? Math.min(...lengths) : 0,
    pages: Math.ceil(words / WORDS_PER_PAGE),
    readingSeconds: Math.round(words / WORDS_PER_MINUTE * 60),
    frequency: ranked.map(([word, count]) => ({ word, count, share: count / top })),
  }
}

export function formatDuration(totalSeconds: number) {
  const part = (value: number) => String(value).padStart(2, '0')
  return `${part(Math.floor(totalSeconds / 3600))}:${part(Math.floor(totalSeconds / 60) % 60)}:${part(totalSeconds % 60)}`
}
