import { create } from 'zustand'
import { getWorkspaceRoot, readProjectData, writeProjectData } from '@grimoire/plugin-api'

export const PLUGIN_ID = 'builtin.quotes'
const MAX_QUOTES = 1000

export interface Quote {
  id: string
  text: string
  sourcePath: string
  author: string
  year: string
  page: string
  title: string
  referenceNumber?: number
  createdAt: number
}

interface QuoteState {
  root: string | null
  items: Quote[]
  error: string
  load(root: string): Promise<void>
  add(data: { text: string; sourcePath?: string; author?: string; year?: string; page?: string; title?: string }): Quote | null
  update(id: string, updates: Partial<Pick<Quote, 'text' | 'author' | 'year' | 'page' | 'title' | 'referenceNumber'>>): void
  remove(id: string): void
}

export const toRelative = (root: string, path: string) => path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path

function parse(text: string): Quote[] {
  try {
    const value: unknown = JSON.parse(text)
    const list = value && typeof value === 'object' && 'items' in value && Array.isArray(value.items) ? value.items : []
    return list.filter((item): item is Quote => !!item && typeof item === 'object'
      && typeof item.id === 'string' && typeof item.text === 'string').slice(0, MAX_QUOTES)
  } catch {
    return []
  }
}

function parseSourceMetadata(path: string): { author: string; year: string; title: string } {
  const fileName = path.replaceAll('\\', '/').split('/').pop()?.replace(/\.[^.]+$/, '') ?? ''
  let author = ''
  let year = ''
  const title = fileName.replace(/[-_]+/g, ' ')

  const yearMatch = /(?:^|\D)(19\d{2}|20\d{2})(?:\D|$)/.exec(fileName)
  if (yearMatch) {
    year = yearMatch[1]
  }

  const authorMatch = /^([A-Z][a-zA-Z]+)(?:[-_\s]+(\d{4}|et[-_\s]al))?/.exec(fileName)
  if (authorMatch && authorMatch[1]) {
    author = authorMatch[1]
  }

  return { author, year, title }
}

let saving: Promise<unknown> = Promise.resolve()

export const useQuotes = create<QuoteState>((set, get) => {
  const persist = () => {
    const { root, items } = get()
    if (!root) return
    saving = saving.then(() => writeProjectData(root, PLUGIN_ID, JSON.stringify({ version: 1, items }, null, 2)))
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
    add: ({ text, sourcePath = '', author, year, page = '', title }) => {
      const root = get().root ?? getWorkspaceRoot()
      if (!root || get().items.length >= MAX_QUOTES) return null
      if (!get().root) set({ root })

      const relative = sourcePath ? toRelative(root, sourcePath) : ''
      const inferred = parseSourceMetadata(relative)

      const quote: Quote = {
        id: crypto.randomUUID(),
        text: text.trim(),
        sourcePath: relative,
        author: author ?? inferred.author,
        year: year ?? inferred.year,
        page,
        title: title ?? inferred.title,
        createdAt: Date.now(),
      }

      set(state => ({ items: [quote, ...state.items] }))
      persist()
      return quote
    },
    update: (id, updates) => {
      set(state => ({
        items: state.items.map(item => item.id === id ? { ...item, ...updates } : item),
      }))
      persist()
    },
    remove: (id) => {
      set(state => ({ items: state.items.filter(item => item.id !== id) }))
      persist()
    },
  }
})
