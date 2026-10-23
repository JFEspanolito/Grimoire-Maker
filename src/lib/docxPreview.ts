import { Unzip, UnzipInflate, strFromU8 } from 'fflate'

export interface WordRun { text: string; bold: boolean; italic: boolean; underline: boolean }
export interface WordParagraph { kind: 'paragraph'; runs: WordRun[] }
export interface WordTable { kind: 'table'; rows: WordParagraph[][][] }
export type WordBlock = WordParagraph | WordTable
interface DocxLimits { maxXmlBytes?: number }

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const STRICT_WORD_NS = 'http://purl.oclc.org/ooxml/wordprocessingml/main'
const isWord = (element: Element, name: string) => element.localName === name
  && (element.namespaceURI === WORD_NS || element.namespaceURI === STRICT_WORD_NS)
const children = (element: Element, name: string) => Array.from(element.children).filter((child) => isWord(child, name))
const descendants = (element: Element, name: string) => Array.from(element.getElementsByTagName('*')).filter((child) => isWord(child, name))

/** Only the main document is inflated; no archive entry is written or fetched. */
function documentXml(bytes: Uint8Array, maxBytes: number): string {
  if (bytes.length > 64 * 1024 * 1024) throw new Error('The Word file is too large to preview (64 MB maximum).')
  let entries = 0
  let seen = false
  let complete = false
  let failure: Error | null = null
  let size = 0
  const chunks: Uint8Array[] = []
  const unzip = new Unzip((file) => {
    if (failure) return
    if (++entries > 5000) { failure = new Error('The Word archive has too many entries.'); return }
    if (file.name !== 'word/document.xml') return
    if (seen) { failure = new Error('Duplicate word/document.xml in Word archive.'); return }
    seen = true
    if (file.originalSize !== undefined && file.originalSize > maxBytes) {
      failure = new Error('The Word document XML is too large to preview.'); return
    }
    file.ondata = (error, chunk, final) => {
      if (failure) return
      if (error) { failure = new Error('The Word archive is damaged.'); return }
      size += chunk.length
      if (size > maxBytes) {
        failure = new Error('The Word document XML is too large to preview.')
        file.terminate()
        return
      }
      chunks.push(chunk)
      complete = final
    }
    file.start()
  })
  unzip.register(UnzipInflate)
  // Bound deflate output per callback; do not inflate a whole hostile entry at once.
  try {
    for (let at = 0; at < bytes.length && !failure; at += 1024) {
      unzip.push(bytes.subarray(at, at + 1024), at + 1024 >= bytes.length)
    }
  } catch { failure ??= new Error('The Word archive is damaged.') }
  if (failure) throw failure
  if (!seen || !complete) throw new Error('The Word file is missing a complete word/document.xml.')
  const output = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length }
  return strFromU8(output)
}

function paragraph(element: Element): WordParagraph {
  const runs = descendants(element, 'r').map((run): WordRun => {
    const properties = children(run, 'rPr')[0]
    const enabled = (name: string) => {
      const property = properties && children(properties, name)[0]
      if (!property) return false
      return !['0', 'false', 'off', 'none'].includes(property.getAttributeNS(property.namespaceURI, 'val') ?? '')
    }
    return {
      text: Array.from(run.children).map((child) => isWord(child, 't') ? child.textContent ?? ''
        : isWord(child, 'br') || isWord(child, 'cr') ? '\n' : isWord(child, 'tab') ? '\t' : '').join(''),
      bold: enabled('b'), italic: enabled('i'), underline: enabled('u'),
    }
  })
  return { kind: 'paragraph', runs }
}

/** Content preview only: relationships, fields, embedded code and external resources are ignored. */
export function readDocx(bytes: Uint8Array, { maxXmlBytes = 8 * 1024 * 1024 }: DocxLimits = {}): WordBlock[] {
  const xml = documentXml(bytes, maxXmlBytes)
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('DOCTYPE and entities are not supported in Word previews.')
  const parsed = new DOMParser().parseFromString(xml, 'application/xml')
  if (parsed.querySelector('parsererror')) throw new Error('The Word document contains invalid XML.')
  const body = descendants(parsed.documentElement, 'body')[0]
  if (!body) throw new Error('The Word document XML has no document body.')
  if (parsed.getElementsByTagName('*').length > 100_000) throw new Error('The Word document is too complex to preview.')
  const blocks: WordBlock[] = []
  for (const child of Array.from(body.children)) {
    if (isWord(child, 'p')) blocks.push(paragraph(child))
    if (isWord(child, 'tbl')) blocks.push({ kind: 'table', rows: children(child, 'tr').map((row) =>
      children(row, 'tc').map((cell) => children(cell, 'p').map(paragraph))) })
  }
  return blocks
}
