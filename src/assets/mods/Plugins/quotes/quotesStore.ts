import { create } from 'zustand'
import { getWorkspaceRoot, readProjectData, writeProjectData } from '@grimoire/plugin-api'
import type { CitationMetadata, CitationStyle } from './citationFormatter'

export const PLUGIN_ID = 'builtin.quotes'
const MAX_QUOTES = 1000

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
  error: string
  load(root: string): Promise<void>
  add(data: Partial<Quote> & { text?: string; quoteText?: string }): Quote | null
  update(id: string, updates: Partial<Quote>): void
  remove(id: string): void
}

export const toRelative = (root: string, path: string) => path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path

function parse(text: string): Quote[] {
  try {
    const value: unknown = JSON.parse(text)
    const list = value && typeof value === 'object' && 'items' in value && Array.isArray(value.items) ? value.items : []
    return list
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

        const validStyles: CitationStyle[] = ['APA', 'IEEE', 'MLA', 'Chicago', 'Harvard']
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
      .slice(0, MAX_QUOTES)
  } catch {
    return []
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

  // Never extract author from filename to avoid contaminating metadata with filenames like References or PaseQA.
  return { year, title }
}

let saving: Promise<unknown> = Promise.resolve()

export const useQuotes = create<QuoteState>((set, get) => {
  const persist = () => {
    const { root, items } = get()
    if (!root) return
    saving = saving.then(() => writeProjectData(root, PLUGIN_ID, JSON.stringify({ version: 2, items }, null, 2)))
      .then(() => { if (get().error) set({ error: '' }) })
      .catch((error: unknown) => set({ error: `Could not save quotes: ${error instanceof Error ? error.message : String(error)}` }))
  }

  return {
    root: null,
    items: [],
    error: '',
    load: async (root) => {
      set({ root, items: [], error: '' })
      try {
        const text = await readProjectData(root, PLUGIN_ID)
        if (get().root === root) set({ items: text ? parse(text) : [] })
      } catch (error) {
        if (get().root === root) set({ error: `Could not read quotes: ${error instanceof Error ? error.message : String(error)}` })
      }
    },
    add: (data) => {
      const root = get().root ?? getWorkspaceRoot()
      if (!root || get().items.length >= MAX_QUOTES) return null
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
  }
})
