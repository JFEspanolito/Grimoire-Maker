import type { FileNode } from '../types/document'
import { splitBinder } from './binder'

/** The book's reading order. Paths are relative to the project root and use `/`. */
export interface DocumentOrder {
  /** Every known document in the order the author chose, unchecked ones included. */
  order: string[]
  /** The documents left out of the exported book. */
  excluded: string[]
}
export interface OrderItem { path: string; included: boolean }

const isMarkdown = (name: string) => /\.md$/i.test(name)

/** Draft documents in the order the explorer shows them; this is the default book order. */
export function draftDocuments(tree: FileNode[], root: string): string[] {
  const draft = splitBinder(tree)?.draft
  const prefix = `${root.replaceAll('\\', '/').replace(/\/+$/, '')}/`
  const collect = (nodes: FileNode[]): string[] => nodes.flatMap((node) =>
    node.isDirectory ? collect(node.children ?? []) : isMarkdown(node.name) ? [node.path.replaceAll('\\', '/').slice(prefix.length)] : [])
  return draft ? collect(draft.children ?? []) : []
}

/**
 * Applies the saved choice to the documents that exist now: deleted ones disappear, and
 * documents that are new since the choice was saved join the end, included.
 */
export function resolveDocumentOrder(available: string[], saved?: DocumentOrder): OrderItem[] {
  const existing = new Set(available)
  const known = (saved?.order ?? []).filter((path, index, all) => existing.has(path) && all.indexOf(path) === index)
  const fresh = available.filter((path) => !known.includes(path))
  const excluded = new Set(saved?.excluded ?? [])
  return [...known, ...fresh].map((path) => ({ path, included: !excluded.has(path) }))
}

export function toDocumentOrder(items: OrderItem[]): DocumentOrder {
  return { order: items.map((item) => item.path), excluded: items.filter((item) => !item.included).map((item) => item.path) }
}

/** The documents the PDF contains, first to last. */
export const includedDocuments = (items: OrderItem[]): string[] => items.filter((item) => item.included).map((item) => item.path)

/** Moves one item a step; the list is returned unchanged at either end. */
export function moveItem(items: OrderItem[], index: number, direction: -1 | 1): OrderItem[] {
  const target = index + direction
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) return items
  const next = [...items]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}
