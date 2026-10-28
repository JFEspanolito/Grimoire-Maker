import { Extension } from '@tiptap/react'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { buildMatcher, MAX_MATCHES, scanText, type SearchOptions } from '../../../lib/searchReplace'

export type SearchQuery = SearchOptions
export interface SearchMatch { from: number; to: number; groups?: RegExpExecArray }

export const searchKey = new PluginKey<SearchQuery>('grimoireSearch')
const EMPTY: SearchQuery = { term: '', caseSensitive: false }

/** Every occurrence inside a single text block; inline leaves count as one character, like positions do. */
export function findMatches(doc: PMNode, query: SearchQuery): SearchMatch[] {
  const matcher = buildMatcher(query)
  if (!matcher.regex) return []
  const matches: SearchMatch[] = []
  doc.descendants((node, position) => {
    if (!node.isTextblock || matches.length >= MAX_MATCHES) return true
    const text = node.textBetween(0, node.content.size, undefined, '￼')
    for (const match of scanText(text, matcher.regex, { cap: MAX_MATCHES - matches.length }).matches) {
      matches.push({ from: position + 1 + match.start, to: position + 1 + match.end, groups: match.groups })
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

/** The selected text when it is a sensible search term (one short line), to pre-fill the Find panel. */
export function selectedSearchText(editor: { state: EditorState }): string | undefined {
  const { from, to, empty } = editor.state.selection
  if (empty || to - from > 200) return undefined
  const text = editor.state.doc.textBetween(from, to, ' ', ' ')
  return text.trim() && !/[\r\n]/.test(text) ? text : undefined
}
