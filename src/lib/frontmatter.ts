import type { Frontmatter } from '../types/document'

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

/**
 * Minimal flat YAML subset: `key: value` pairs with string, number and boolean
 * scalars. Enough for document metadata; swap for a full YAML parser if nested
 * metadata is ever needed.
 */
function parseScalar(raw: string): string | number | boolean {
  const value = raw.trim()
  if (value === 'true') return true
  if (value === 'false') return false
  if (value !== '' && !Number.isNaN(Number(value))) return Number(value)
  if (/^(".*"|'.*')$/.test(value)) return value.slice(1, -1)
  return value
}

function formatScalar(value: unknown): string {
  if (typeof value === 'string') {
    return /^[\w .,-]+$/.test(value) && value.trim() === value && Number.isNaN(Number(value))
      ? value
      : JSON.stringify(value)
  }
  return String(value)
}

export function parseDocument(raw: string): { frontmatter: Frontmatter; body: string } {
  const match = FENCE.exec(raw)
  if (!match) return { frontmatter: {}, body: raw }

  const frontmatter: Frontmatter = {}
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    frontmatter[line.slice(0, idx).trim()] = parseScalar(line.slice(idx + 1))
  }
  return { frontmatter, body: raw.slice(match[0].length) }
}

export function serializeDocument(frontmatter: Frontmatter, body: string): string {
  const entries = Object.entries(frontmatter).filter(([, v]) => v !== undefined && v !== null)
  if (entries.length === 0) return body
  const yaml = entries.map(([k, v]) => `${k}: ${formatScalar(v)}`).join('\n')
  return `---\n${yaml}\n---\n${body}`
}
