import { create } from 'zustand'
import { getWorkspaceRoot, readProjectData, writeProjectData } from '@grimoire/plugin-api'
import type { CitationMetadata, CitationStyle, ReferenceItem } from './citationFormatter'

export const PLUGIN_ID = 'builtin.quotes'
const MAX_ITEMS = 1000

export type QuoteType = CitationStyle

export interface Quote extends CitationMetadata {
  /** Backwards compatibility alias for quoteText */
  text?: string
  /** Backwards compatibility alias for authorLastName */
  author?: string
  /** Backwards compatibility alias for refIndex */
  referenceNumber?: number
}

interface QuoteState {
  root: string | null
  items: Quote[]
  references: ReferenceItem[]
  error: string
  load(root: string): Promise<void>
  add(data: Partial<Quote> & { text?: string; quoteText?: string }): Quote | null
  update(id: string, updates: Partial<Quote>): void
  remove(id: string): void
  addReference(data: Partial<ReferenceItem>): ReferenceItem | null
  updateReference(id: string, updates: Partial<ReferenceItem>): void
  removeReference(id: string): void
}

export const toRelative = (root: string, path: string) => path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path

function parse(text: string): { items: Quote[]; references: ReferenceItem[] } {
  try {
    const value: unknown = JSON.parse(text)
    const rawItems = value && typeof value === 'object' && 'items' in value && Array.isArray(value.items) ? value.items : []
    const rawRefs = value && typeof value === 'object' && 'references' in value && Array.isArray(value.references) ? value.references : []

    const validStyles: CitationStyle[] = ['APA', 'IEEE', 'MLA', 'Chicago', 'Harvard']

    const items = rawItems
      .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && typeof item.id === 'string')
      .map((item): Quote => {
        const quoteText = String(item.quoteText ?? item.text ?? '').trim()
        const rawAuthor = String(item.authorLastName ?? item.author ?? '').trim()
        let authorLastName = rawAuthor
        let authorInitial = String(item.authorInitial ?? '').trim()

        if (!authorInitial && rawAuthor.includes(',')) {
          const parts = rawAuthor.split(',').map(s => s.trim())
          authorLastName = parts[0]
          authorInitial = parts[1] || ''
        }

        const quoteType = (validStyles.includes(item.quoteType as CitationStyle)
          ? item.quoteType
          : 'APA') as CitationStyle

        const refIndex = typeof item.refIndex === 'number'
          ? item.refIndex
          : typeof item.referenceNumber === 'number'
            ? item.referenceNumber
            : undefined

        const quote: Quote = {
          id: String(item.id),
          quoteText,
          text: quoteText,
          sourcePath: String(item.sourcePath ?? ''),
          authorLastName,
          author: authorLastName,
          authorInitial,
          year: String(item.year ?? ''),
          page: String(item.page ?? ''),
          title: String(item.title ?? ''),
          sourceContainer: String(item.sourceContainer ?? ''),
          doiOrUrl: String(item.doiOrUrl ?? ''),
          quoteType,
          refIndex,
          referenceNumber: refIndex,
          createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now(),
        }
        return quote
      })
      .slice(0, MAX_ITEMS)

    const references = rawRefs
      .filter((ref): ref is Record<string, unknown> => !!ref && typeof ref === 'object' && typeof ref.id === 'string')
      .map((ref, idx): ReferenceItem => {
        const style = (validStyles.includes(ref.style as CitationStyle)
          ? ref.style
          : 'APA') as CitationStyle

        return {
          id: String(ref.id),
          refIndex: typeof ref.refIndex === 'number' ? ref.refIndex : idx + 1,
          authors: String(ref.authors ?? '').trim(),
          year: String(ref.year ?? '').trim(),
          title: String(ref.title ?? '').trim(),
          sourceContainer: String(ref.sourceContainer ?? '').trim(),
          volumeIssuePages: String(ref.volumeIssuePages ?? '').trim(),
          doiOrUrl: String(ref.doiOrUrl ?? '').trim(),
          style,
          createdAt: typeof ref.createdAt === 'number' ? ref.createdAt : Date.now(),
        }
      })
      .slice(0, MAX_ITEMS)

    return { items, references }
  } catch {
    return { items: [], references: [] }
  }
}

function parseSourceMetadata(path: string): { year: string; title: string } {
  const fileName = path.replaceAll('\\', '/').split('/').pop()?.replace(/\.[^.]+$/, '') ?? ''
  let year = ''
  const title = fileName.replace(/[-_]+/g, ' ')

  const yearMatch = /(?:^|\D)(19\d{2}|20\d{2})(?:\D|$)/.exec(fileName)
  if (yearMatch) {
    year = yearMatch[1]
  }

  return { year, title }
}

let saving: Promise<unknown> = Promise.resolve()

export const useQuotes = create<QuoteState>((set, get) => {
  const persist = () => {
    const { root, items, references } = get()
    if (!root) return
    saving = saving.then(() => writeProjectData(root, PLUGIN_ID, JSON.stringify({ version: 2, items, references }, null, 2)))
      .then(() => { if (get().error) set({ error: '' }) })
      .catch((error: unknown) => set({ error: `Could not save quotes: ${error instanceof Error ? error.message : String(error)}` }))
  }

  return {
    root: null,
    items: [],
    references: [],
    error: '',
    load: async (root) => {
      set({ root, items: [], references: [], error: '' })
      try {
        const text = await readProjectData(root, PLUGIN_ID)
        if (get().root === root) {
          const parsed = text ? parse(text) : { items: [], references: [] }
          set({ items: parsed.items, references: parsed.references })
        }
      } catch (error) {
        if (get().root === root) set({ error: `Could not read quotes: ${error instanceof Error ? error.message : String(error)}` })
      }
    },
    add: (data) => {
      const root = get().root ?? getWorkspaceRoot()
      if (!root || get().items.length >= MAX_ITEMS) return null
      if (!get().root) set({ root })

      const relative = data.sourcePath ? toRelative(root, data.sourcePath) : ''
      const inferred = parseSourceMetadata(relative)
      const qText = (data.quoteText ?? data.text ?? '').trim()
      const aLastName = (data.authorLastName ?? data.author ?? '').trim()

      const quote: Quote = {
        id: crypto.randomUUID(),
        quoteText: qText,
        text: qText,
        sourcePath: relative,
        authorLastName: aLastName,
        author: aLastName,
        authorInitial: (data.authorInitial ?? '').trim(),
        year: data.year ? String(data.year).trim() : inferred.year,
        page: data.page ? String(data.page).trim() : '',
        title: (data.title ?? inferred.title).trim(),
        sourceContainer: (data.sourceContainer ?? '').trim(),
        doiOrUrl: (data.doiOrUrl ?? '').trim(),
        quoteType: data.quoteType ?? 'APA',
        refIndex: data.refIndex ?? data.referenceNumber,
        referenceNumber: data.refIndex ?? data.referenceNumber,
        createdAt: Date.now(),
      }

      set(state => ({ items: [quote, ...state.items] }))
      persist()
      return quote
    },
    update: (id, updates) => {
      set(state => ({
        items: state.items.map(item => {
          if (item.id !== id) return item
          const quoteText = updates.quoteText ?? updates.text ?? item.quoteText
          const authorLastName = updates.authorLastName ?? updates.author ?? item.authorLastName
          const refIndex = updates.refIndex ?? updates.referenceNumber ?? item.refIndex
          return {
            ...item,
            ...updates,
            quoteText,
            text: quoteText,
            authorLastName,
            author: authorLastName,
            refIndex,
            referenceNumber: refIndex,
          }
        }),
      }))
      persist()
    },
    remove: (id) => {
      set(state => ({ items: state.items.filter(item => item.id !== id) }))
      persist()
    },
    addReference: (data) => {
      const root = get().root ?? getWorkspaceRoot()
      if (!root || get().references.length >= MAX_ITEMS) return null
      if (!get().root) set({ root })

      // Calculate next sequential refIndex
      let maxIndex = 0
      for (const r of get().references) {
        if (r.refIndex > maxIndex) maxIndex = r.refIndex
      }
      for (const q of get().items) {
        const idx = q.refIndex ?? q.referenceNumber ?? 0
        if (idx > maxIndex) maxIndex = idx
      }

      const refItem: ReferenceItem = {
        id: crypto.randomUUID(),
        refIndex: data.refIndex ?? (maxIndex + 1),
        authors: (data.authors ?? '').trim(),
        year: (data.year ?? '').trim(),
        title: (data.title ?? '').trim(),
        sourceContainer: (data.sourceContainer ?? '').trim(),
        volumeIssuePages: (data.volumeIssuePages ?? '').trim(),
        doiOrUrl: (data.doiOrUrl ?? '').trim(),
        style: data.style ?? 'APA',
        createdAt: Date.now(),
      }

      set(state => ({ references: [refItem, ...state.references] }))
      persist()
      return refItem
    },
    updateReference: (id, updates) => {
      set(state => ({
        references: state.references.map(r => r.id === id ? { ...r, ...updates } : r),
      }))
      persist()
    },
    removeReference: (id) => {
      set(state => ({ references: state.references.filter(r => r.id !== id) }))
      persist()
    },
  }
})
