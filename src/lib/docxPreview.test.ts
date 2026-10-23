import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { readDocx } from './docxPreview'

const document = (body: string) => `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`
const pack = (xml: string) => zipSync({ 'word/document.xml': strToU8(xml) })

describe('read-only Word content', () => {
  it('reads paragraphs, styled runs and tables in document order', () => {
    const blocks = readDocx(pack(document('<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Hello</w:t><w:br/><w:t>world</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>')))
    expect(blocks).toEqual([
      { kind: 'paragraph', runs: [{ text: 'Hello\nworld', bold: true, italic: false, underline: false }] },
      { kind: 'table', rows: [[[{ kind: 'paragraph', runs: [{ text: 'Cell', bold: false, italic: false, underline: false }] }]]] },
    ])
  })

  it('treats escaped markup as text and never loads external relationships', () => {
    const xml = document('<w:p><w:hyperlink><w:r><w:t>&lt;script&gt;bad&lt;/script&gt;</w:t></w:r></w:hyperlink></w:p>')
    const bytes = zipSync({ 'word/document.xml': strToU8(xml), 'word/_rels/document.xml.rels': strToU8('https://example.com/private') })
    expect(readDocx(bytes)).toEqual([{ kind: 'paragraph', runs: [{ text: '<script>bad</script>', bold: false, italic: false, underline: false }] }])
  })

  it('rejects malformed, missing and duplicate main documents', () => {
    expect(() => readDocx(new Uint8Array([1, 2]))).toThrow()
    expect(() => readDocx(zipSync({ 'other.xml': strToU8('') }))).toThrow(/document.xml/)
    expect(() => readDocx(pack('<w:document>'))).toThrow(/XML/)
  })

  it('rejects doctypes and limits inflated main-document size', () => {
    expect(() => readDocx(pack('<!DOCTYPE x><x/>'))).toThrow(/DOCTYPE/)
    expect(() => readDocx(pack(document(`<w:p>${'x'.repeat(500)}</w:p>`)), { maxXmlBytes: 100 })).toThrow(/too large/)
  })

  it('does not inflate irrelevant archive entries', () => {
    const bytes = zipSync({ 'word/media/large.bin': new Uint8Array(100_000), 'word/document.xml': strToU8(document('')) })
    expect(readDocx(bytes, { maxXmlBytes: 500 })).toEqual([])
  })
})
