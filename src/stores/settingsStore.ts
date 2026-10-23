import { create } from 'zustand'
import type { PageSizeId, ThemeId, ViewMode } from '../types/document'

interface SettingsState {
  pageSize: PageSizeId
  columns: 1 | 2
  theme: ThemeId
  viewMode: ViewMode
  /** Print bleed in millimetres. */
  bleedMm: number
  marginMm: number
  setPageSize: (pageSize: PageSizeId) => void
  setColumns: (columns: 1 | 2) => void
  setTheme: (theme: ThemeId) => void
  setViewMode: (viewMode: ViewMode) => void
}

export const useSettingsStore = create<SettingsState>((set) => ({
  pageSize: 'a4',
  columns: 2,
  theme: 'parchment',
  viewMode: 'single',
  bleedMm: 3,
  marginMm: 15,
  setPageSize: (pageSize) => set({ pageSize }),
  setColumns: (columns) => set({ columns }),
  setTheme: (theme) => set({ theme }),
  setViewMode: (viewMode) => set({ viewMode }),
}))
