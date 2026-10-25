import { expect, it } from 'vitest'
import { computeStatistics, formatDuration } from './statistics'

it('counts words, characters, paragraphs and sentences without Markdown syntax', () => {
  const stats = computeStatistics(['# Title\n\nHello **brave** world. Again [link](http://x.y)!\n![img](a.png)'])
  expect(stats).toMatchObject({ words: 6, paragraphs: 2, sentences: 3, documents: 1, pages: 1 })
  expect(stats.characters).toBe('TitleHello brave world. Again link!'.length)
  expect(stats.charactersNoSpaces).toBe('TitleHellobraveworld.Againlink!'.length)
})

it('summarises document lengths and ranks word frequency against the top word', () => {
  const stats = computeStatistics(['a a a a', 'b b', 'Sda'])
  expect(stats).toMatchObject({ documents: 3, longestDocument: 4, shortestDocument: 1, averageDocumentLength: 2 })
  expect(stats.frequency.map((entry) => [entry.word, entry.count, entry.share])).toEqual([['a', 4, 1], ['b', 2, 0.5], ['sda', 1, 0.25]])
})

it('handles no documents and formats reading time', () => {
  expect(computeStatistics([])).toMatchObject({ words: 0, documents: 0, longestDocument: 0, pages: 0, frequency: [] })
  expect(formatDuration(3725)).toBe('01:02:05')
})

it('strips embedded HTML tags, attributes and entities so only visible prose is counted', () => {
  const htmlBlock = '<div data-type="standard-content-box" class="grimoire-content-box" style="width:90mm;">'
    + '<h3>Treasure &amp; Loot</h3>'
    + '<table style="min-width: 75px;"><colgroup><col style="min-width: 25px;"></colgroup>'
    + '<tbody><tr><th><p>d100</p></th><th><p>Value</p></th></tr>'
    + '<tr><td><p>01–50</p></td><td><p></p></td></tr></tbody></table></div>'
  const stats = computeStatistics([htmlBlock])
  expect(stats.words).toBe(6)
  const words = stats.frequency.map((entry) => entry.word)
  expect(words).toEqual(['01', '50', 'd100', 'loot', 'treasure', 'value'])
  expect(words).not.toContain('p')
  expect(words).not.toContain('td')
  expect(words).not.toContain('style')
  expect(words).not.toContain('amp')
})
