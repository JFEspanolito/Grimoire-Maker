import { describe, expect, it } from 'vitest'
import { CitationFormatter, type CitationMetadata } from '../assets/mods/Plugins/quotes/citationFormatter'

describe('CitationFormatter', () => {
  const sampleMeta: CitationMetadata = {
    id: 'test-1',
    refIndex: 2,
    quoteText: 'Persistent Digital Identifiers: Include active DOIs for all datasets.',
    authorLastName: 'Smith',
    authorInitial: 'J.',
    year: '2026',
    page: '2',
    title: 'Data Management Guidelines',
    sourceContainer: 'Tech Press',
    doiOrUrl: 'https://doi.org/10.1000/182',
  }

  describe('APA 7th Edition', () => {
    it('formats short quote inline with author-date without em-dash or brackets', () => {
      const inline = CitationFormatter.formatInline(sampleMeta, 'APA')
      expect(inline).toBe('"Persistent Digital Identifiers: Include active DOIs for all datasets." (Smith, 2026, p. 2).')
      expect(inline).not.toContain('—')
      expect(inline).not.toContain('[2]')
    })

    it('formats block quote for quotes with 40 or more words without quotation marks', () => {
      const longText = 'Word '.repeat(45).trim()
      const inline = CitationFormatter.formatInline({ ...sampleMeta, quoteText: longText }, 'APA')
      expect(inline).toMatch(/^> Word .+\n>\n> \(Smith, 2026, p\. 2\)\n$/)
      expect(inline).not.toContain('"')
    })

    it('formats bibliography entry alphabetically structured', () => {
      const bib = CitationFormatter.formatBibliography(sampleMeta, 'APA')
      expect(bib).toBe('Smith, J. (2026). *Data Management Guidelines*. Tech Press. https://doi.org/10.1000/182')
      expect(bib).not.toMatch(/^\[?\d+\]?\./)
    })
  })

  describe('IEEE', () => {
    it('formats inline citation with numeric bracket only', () => {
      const inline = CitationFormatter.formatInline(sampleMeta, 'IEEE')
      expect(inline).toBe('"Persistent Digital Identifiers: Include active DOIs for all datasets." [2, p. 2].')
      expect(inline).not.toContain('Smith')
      expect(inline).not.toContain('2026')
    })

    it('formats inline citation without page when page is missing', () => {
      const inline = CitationFormatter.formatInline({ ...sampleMeta, page: '' }, 'IEEE')
      expect(inline).toBe('"Persistent Digital Identifiers: Include active DOIs for all datasets." [2].')
    })

    it('formats bibliography entry with numeric index prefix', () => {
      const bib = CitationFormatter.formatBibliography(sampleMeta, 'IEEE')
      expect(bib).toBe('[2] J. Smith, *Data Management Guidelines*. Tech Press, 2026, p. 2. https://doi.org/10.1000/182')
    })
  })

  describe('MLA 9th Edition', () => {
    it('formats inline citation with author and page without year or "p."', () => {
      const inline = CitationFormatter.formatInline(sampleMeta, 'MLA')
      expect(inline).toBe('"Persistent Digital Identifiers: Include active DOIs for all datasets." (Smith 2).')
      expect(inline).not.toContain('2026')
      expect(inline).not.toContain('p.')
    })

    it('formats bibliography without numbering', () => {
      const bib = CitationFormatter.formatBibliography({ ...sampleMeta, doiOrUrl: '' }, 'MLA')
      expect(bib).toBe('Smith, J. *Data Management Guidelines*. Tech Press, 2026.')
    })
  })

  describe('Chicago', () => {
    it('formats inline citation with footnote reference at end of quote', () => {
      const inline = CitationFormatter.formatInline(sampleMeta, 'Chicago')
      expect(inline).toBe('"Persistent Digital Identifiers: Include active DOIs for all datasets."^[2]')
    })

    it('formats bibliography / note entry with index bracket and parenthesized publication', () => {
      const bib = CitationFormatter.formatBibliography({ ...sampleMeta, doiOrUrl: '' }, 'Chicago')
      expect(bib).toBe('[2] J. Smith, *Data Management Guidelines* (Tech Press, 2026), 2.')
    })
  })

  describe('Harvard', () => {
    it('formats inline citation with colon page separator', () => {
      const inline = CitationFormatter.formatInline(sampleMeta, 'Harvard')
      expect(inline).toBe('"Persistent Digital Identifiers: Include active DOIs for all datasets." (Smith 2026:2).')
    })

    it('formats bibliography without period after year parenthesis', () => {
      const bib = CitationFormatter.formatBibliography({ ...sampleMeta, doiOrUrl: '' }, 'Harvard')
      expect(bib).toBe('Smith, J. (2026) *Data Management Guidelines*. Tech Press.')
    })
  })

  describe('Fallback handling', () => {
    it('uses [Autor Desconocido] when authorLastName is missing', () => {
      const inline = CitationFormatter.formatInline({ ...sampleMeta, authorLastName: '' }, 'APA')
      expect(inline).toContain('([Autor Desconocido], 2026, p. 2)')
    })
  })
})
