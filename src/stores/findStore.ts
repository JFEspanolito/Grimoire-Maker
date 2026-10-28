import { create } from 'zustand'
import type { AppliedChange } from '../lib/projectSearch'

export type FindScope = 'file' | 'project'

interface FindState {
  open: boolean
  scope: FindScope
  term: string
  replacement: string
  caseSensitive: boolean
  wholeWord: boolean
  regex: boolean
  replaceOpen: boolean
  /** Which field the panel focuses when `focusToken` changes. */
  focusTarget: 'find' | 'replace'
  focusToken: number
  /** F3 / Shift+F3 while the panel is open; the panel performs the step when the token changes. */
  step: { direction: 1 | -1; token: number }
  /** What the last Project replace-all changed, for `Undo last replace`. Session memory only. */
  lastReplace: AppliedChange[] | null
  setLastReplace: (changes: AppliedChange[] | null) => void
  /** Opens or focuses the panel. `seed` (the editor selection) replaces the term when given. */
  show: (options?: { replace?: boolean; seed?: string }) => void
  hide: () => void
  requestStep: (direction: 1 | -1) => void
  set: (patch: Partial<Pick<FindState, 'scope' | 'term' | 'replacement' | 'caseSensitive' | 'wholeWord' | 'regex' | 'replaceOpen'>>) => void
}

/** The panel's last term and options live here, so they survive closing it for as long as the app runs. */
export const useFindStore = create<FindState>((set) => ({
  open: false,
  scope: 'file',
  term: '',
  replacement: '',
  caseSensitive: false,
  wholeWord: false,
  regex: false,
  replaceOpen: true,
  focusTarget: 'find',
  focusToken: 0,
  step: { direction: 1, token: 0 },
  lastReplace: null,
  setLastReplace: (lastReplace) => set({ lastReplace }),
  show: ({ replace = false, seed } = {}) => set((state) => ({
    open: true,
    term: seed ? seed : state.term,
    replaceOpen: replace ? true : state.replaceOpen,
    focusTarget: replace ? 'replace' : 'find',
    focusToken: state.focusToken + 1,
  })),
  hide: () => set({ open: false }),
  requestStep: (direction) => set((state) => ({ step: { direction, token: state.step.token + 1 } })),
  set: (patch) => set(patch),
}))
