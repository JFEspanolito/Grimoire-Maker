import { create } from 'zustand'
import { remapPath } from '../lib/binder'

interface TabState {
  paths: string[]
  active: string | null
  open: (path: string, newTab?: boolean) => void
  reset: (path: string | null) => void
  remap: (from: string, to: string) => void
  remove: (path: string) => void
}

export const useTabStore = create<TabState>((set) => ({
  paths: [],
  active: null,
  open: (path, newTab = false) => set((state) => {
    if (state.paths.includes(path)) return { active: path }
    if (newTab || !state.active) return { paths: [...state.paths, path], active: path }
    return { paths: state.paths.map((current) => current === state.active ? path : current), active: path }
  }),
  reset: (path) => set({ paths: path ? [path] : [], active: path }),
  remap: (from, to) => set((state) => ({
    paths: state.paths.map((path) => remapPath(path, from, to) ?? path),
    active: remapPath(state.active, from, to),
  })),
  remove: (path) => set((state) => ({
    paths: state.paths.filter((current) => current !== path),
    active: state.active === path ? null : state.active,
  })),
}))
