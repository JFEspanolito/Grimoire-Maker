import { fromMarkdown } from 'mdast-util-from-markdown'
import { parseFragment, type DefaultTreeAdapterTypes } from 'parse5'
import { normalizePath } from './assetPaths'

interface Span { start: number; end: number }
interface Destination extends Span { markdown: boolean; quoted?: boolean }
interface Replacement extends Span { value: string }
interface DecodedSource { value: string; offsets: number[] }

const canonical = (path: string) => normalizePath(path.replaceAll('\\', '/')).toLowerCase()
const parent = (path: string) => path.slice(0, path.lastIndexOf('/'))
const encodeFilename = (name: string) => encodeURIComponent(name).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
const ENTITIES: Record<string, string> = { '&': '&amp;', '"': '&quot;', "'": '&#39;' }
/** Quoted HTML values keep literal spaces; only URL delimiters and attribute syntax are escaped. */
const encodeQuotedHtmlFilename = (name: string) => name
  .replace(/[%#?]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  .replace(/[&"']/g, (c) => ENTITIES[c])

/** Decode syntax while retaining a boundary map into the untouched source. */
function decodeSource(source: string, markdown: boolean): DecodedSource {
  let value = ''
  const offsets: number[] = []
  for (let i = 0; i < source.length;) {
    const start = i
    let decoded = source[i++]
    if (markdown && decoded === '\\' && /[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]/.test(source[i] ?? '')) {
      decoded = source[i++]
    } else if (decoded === '&') {
      const match = /^&(?:#[xX][\da-fA-F]+|#\d+|[a-zA-Z][a-zA-Z\d]+);/.exec(source.slice(start))
      if (match) {
        const parsed = parseFragment(`<i data-value="${match[0]}">`).childNodes[0]
        if (parsed && 'attrs' in parsed) decoded = parsed.attrs[0].value
        i = start + match[0].length
      }
    }
    for (let j = 0; j < decoded.length; j++) offsets.push(start)
    value += decoded
  }
  offsets.push(source.length)
  return { value, offsets }
}

function renamedDestination(source: string, markdown: boolean, quoted: boolean, documentPath: string, from: string, filename: string): string | null {
  const { value, offsets } = decodeSource(source, markdown)
  const suffix = value.search(/[?#]/)
  const end = suffix < 0 ? value.length : suffix
  const urlPath = value.slice(0, end)
  if (!urlPath || urlPath.startsWith('//') || urlPath.startsWith('\\\\')) return null
  let path = urlPath
  if (/^file:/i.test(path)) {
    // Only local file URLs: network authorities are deliberately not rewritten.
    if (!/^file:\/\/\//i.test(path)) return null
    path = path.slice(7).replace(/^\/([a-z]:\/)/i, '$1')
  } else if (/^[a-z][\w+.-]*:/i.test(path) && !/^[a-z]:[/\\]/i.test(path)) return null
  try { path = decodeURIComponent(path) } catch { return null }
  path = path.replaceAll('\\', '/')
  const resolved = /^[a-z]:\//i.test(path) || path.startsWith('/') ? path : `${parent(documentPath.replaceAll('\\', '/'))}/${path}`
  if (canonical(resolved) !== canonical(from)) return null
  // The prefix up to the last separator (literal or percent-encoded) stays byte-for-byte.
  let prefixEnd = 0
  for (const separator of urlPath.matchAll(/[/\\]|%2f|%5c/gi)) prefixEnd = separator.index + separator[0].length
  const encoded = !markdown && quoted ? encodeQuotedHtmlFilename(filename) : encodeFilename(filename)
  return source.slice(0, offsets[prefixEnd]) + encoded + source.slice(offsets[end])
}

/**
 * Rename local Markdown/HTML destinations without serializing the document.
 * Supports same-parent file renames, CommonMark destinations and HTML src/href.
 * Does not interpret srcset, CSS URLs, template expressions or remote authorities.
 * Encoded directory separators in the reference prefix are preserved as written.
 */
export function rewriteMarkdownReferences(raw: string, documentPath: string, from: string, to: string): string {
  const normalizedFrom = from.replaceAll('\\', '/')
  const normalizedTo = to.replaceAll('\\', '/')
  if (canonical(parent(normalizedFrom)) !== canonical(parent(normalizedTo))) {
    throw new Error('Reference updates require a file rename within the same parent directory')
  }
  const filename = normalizedTo.slice(normalizedTo.lastIndexOf('/') + 1)
  const destinations: Destination[] = []
  // Mask frontmatter rather than removing it, retaining every absolute offset.
  const frontmatter = /^(?:\uFEFF)?---[^\S\r\n]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[^\S\r\n]*(?=\r?\n|$)/.exec(raw)
  const masked = frontmatter ? frontmatter[0].replace(/[^\r\n]/g, ' ') + raw.slice(frontmatter[0].length) : raw
  // micromark drops a leading BOM, which would shift every offset; mask it to keep them aligned with raw.
  const source = masked.startsWith('﻿') ? ` ${masked.slice(1)}` : masked
  const tree = fromMarkdown(source, { mdastExtensions: [{ afterExit(token) {
    if (token.type === 'resourceDestinationString' || token.type === 'definitionDestinationString') {
      destinations.push({ start: token.start.offset, end: token.end.offset, markdown: true })
    }
  } }] })
  // Parse HTML tokens together so script/code containers protect their contents,
  // including when CommonMark splits an inline container into separate nodes.
  const html: string[] = source.split('').map((c) => c === '\r' || c === '\n' ? c : ' ')
  const visitMarkdown = (node: typeof tree | (typeof tree.children)[number]): void => {
    if (node.type === 'html' && node.position) {
      const start = node.position.start.offset!
      const end = node.position.end.offset!
      for (let i = start; i < end; i++) html[i] = source[i]
    }
    if ('children' in node) for (const child of node.children) visitMarkdown(child)
  }
  visitMarkdown(tree)
  const excluded: Span[] = []
  const visitHtml = (node: DefaultTreeAdapterTypes.Node, protectedParent = false): void => {
    const protectedNode = protectedParent || ('tagName' in node && ['script', 'style', 'code', 'pre', 'textarea'].includes(node.tagName))
    if ('tagName' in node) {
      const location = node.sourceCodeLocation
      if (protectedNode && location) excluded.push({ start: location.startOffset, end: location.endTag ? location.endOffset : raw.length })
      if (!protectedNode && location?.attrs) for (const attr of node.attrs) {
        if (attr.name !== 'src' && attr.name !== 'href') continue
        const span = location.attrs[attr.name]
        if (!span) continue
        const attribute = raw.slice(span.startOffset, span.endOffset)
        const prefix = /^[^=]+=[\t\n\f\r ]*(["']?)/.exec(attribute)
        if (!prefix) continue
        const start = span.startOffset + prefix[0].length
        const end = span.endOffset - (prefix[1] ? 1 : 0)
        destinations.push({ start, end, markdown: false, quoted: Boolean(prefix[1]) })
      }
    }
    if ('childNodes' in node) for (const child of node.childNodes) visitHtml(child, protectedNode)
    if ('content' in node) visitHtml(node.content, protectedNode)
  }
  visitHtml(parseFragment(html.join(''), { sourceCodeLocationInfo: true }))
  const replacements: Replacement[] = []
  for (const destination of destinations) {
    if (excluded.some((span) => destination.start >= span.start && destination.start < span.end)) continue
    const previous = raw.slice(destination.start, destination.end)
    const value = renamedDestination(previous, destination.markdown, destination.quoted ?? false, documentPath, normalizedFrom, filename)
    if (value !== null && value !== previous) replacements.push({ ...destination, value })
  }
  let result = raw
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    result = result.slice(0, replacement.start) + replacement.value + result.slice(replacement.end)
  }
  return result
}
