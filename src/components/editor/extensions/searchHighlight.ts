import { Extension } from '@tiptap/react'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export interface SearchQuery { term: string; caseSensitive: boolean }
export interface SearchMatch { from: number; to: number }

export const searchKey = new PluginKey<SearchQuery>('grimoireSearch')
const EMPTY: SearchQuery = { term: '', caseSensitive: false }

/** Every occurrence inside a single text block; inline leaves count as one character, like positions do. */
export function findMatches(doc: PMNode, { term, caseSensitive }: SearchQuery): SearchMatch[] {
  if (!term) return []
  const needle = caseSensitive ? term : term.toLowerCase()
  const matches: SearchMatch[] = []
  doc.descendants((node, position) => {
    if (!node.isTextblock) return true
    const text = node.textBetween(0, node.content.size, undefined, '￼')
    const haystack = caseSensitive ? text : text.toLowerCase()
    for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) {
      matches.push({ from: position + 1 + at, to: position + 1 + at + needle.length })
    }
    return false
  })
  return matches
}

export const currentQuery = (state: EditorState): SearchQuery => searchKey.getState(state) ?? EMPTY

declare module '@tiptap/react' {
  interface Commands<ReturnType> {
    search: { setSearch: (query: SearchQuery) => ReturnType }
  }
}

/** Highlights matches of the Find dialog; the match under the selection stands out. */
export const SearchHighlight = Extension.create({
  name: 'searchHighlight',
  addCommands() {
    return {
      setSearch: (query) => ({ tr, dispatch }) => {
        if (dispatch) dispatch(tr.setMeta(searchKey, query))
        return true
      },
    }
  },
  addProseMirrorPlugins() {
    return [new Plugin<SearchQuery>({
      key: searchKey,
      state: {
        init: () => EMPTY,
        apply: (tr, previous) => (tr.getMeta(searchKey) as SearchQuery | undefined) ?? previous,
      },
      props: {
        decorations(state) {
          const query = searchKey.getState(state)
          if (!query?.term) return DecorationSet.empty
          const { from, to } = state.selection
          return DecorationSet.create(state.doc, findMatches(state.doc, query).map((match) =>
            Decoration.inline(match.from, match.to, { class: match.from === from && match.to === to ? 'search-match search-current' : 'search-match' })))
        },
      },
    })]
  },
})
