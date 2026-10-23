import { create } from 'zustand'
import { remapPath } from '../lib/binder'

interface TabState {
  paths: string[]
  active: string | null
  split: boolean
  activePane: 0 | 1
  panes: [string | null, string | null]
  toggleSplit: () => void
  focusPane: (pane: 0 | 1) => void
  open: (path: string, newTab?: boolean) => void
  reset: (path: string | null) => void
  remap: (from: string, to: string) => void
  remove: (path: string) => void
}

export const useTabStore = create<TabState>((set) => ({
  paths: [],
  active: null,
  split: false,
  activePane: 0,
  panes: [null, null],
  focusPane: (activePane) => set((state) => ({ activePane, active: state.panes[activePane] })),
  toggleSplit: () => set((state) => state.split
    ? { split: false, activePane: 0, panes: [state.active, null] }
    : { split: true, panes: [state.active, state.paths.find((path) => path !== state.active) ?? null] }),
  open: (path) => set((state) => {
    const panes: [string | null, string | null] = [...state.panes]
    panes[state.activePane] = path
    // A document is mounted once: selecting it in the other pane swaps assignments.
    if (panes[1 - state.activePane] === path) panes[1 - state.activePane] = state.panes[state.activePane]
    return { paths: state.paths.includes(path) ? state.paths : [...state.paths, path], active: path, panes }
  }),
  reset: (path) => set({ paths: path ? [path] : [], active: path, panes: [path, null], activePane: 0, split: false }),
  remap: (from, to) => set((state) => ({
    paths: state.paths.map((path) => remapPath(path, from, to) ?? path),
    active: remapPath(state.active, from, to),
    panes: state.panes.map((path) => remapPath(path, from, to)) as [string | null, string | null],
  })),
  remove: (path) => set((state) => {
    const paths = state.paths.filter((current) => current !== path)
    const replacement = paths.find((current) => !state.panes.includes(current)) ?? null
    const panes = state.panes.map((current) => current === path ? replacement : current) as [string | null, string | null]
    return { paths, panes, active: panes[state.activePane] }
  }),
}))
