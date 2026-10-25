import { create } from 'zustand'
import type { PageSizeId, ThemeId, ViewMode } from '../types/document'
import type { RulerGuide } from '../types/ruler'

interface SettingsState {
  pageSize: PageSizeId
  columns: 1 | 2
  theme: ThemeId
  viewMode: ViewMode
  zoom: number
  showDocumentIndex: boolean
  setShowDocumentIndex: (show: boolean) => void
  autoCommitEnabled: boolean
  autoCommitMinutes: number
  autoCommitMessage: string
  setAutoCommitSettings: (enabled: boolean, minutes: number, message: string) => void
  autoSaveSeconds: number
  setAutoSaveSeconds: (seconds: number) => void
  setZoom: (zoom: number) => void
  /** Print bleed in millimetres. */
  bleedMm: number
  marginMm: number
  rulerGuides: RulerGuide[]
  setRulerGuides: (rulerGuides: RulerGuide[]) => void
  setPageSize: (pageSize: PageSizeId) => void
  setColumns: (columns: 1 | 2) => void
  setTheme: (theme: ThemeId) => void
  setViewMode: (viewMode: ViewMode) => void
}

export const useSettingsStore = create<SettingsState>((set) => ({
  pageSize: 'a4',
  columns: 2,
  theme: 'parchment',
  viewMode: 'edit',
  zoom: 1,
  showDocumentIndex: true,
  setShowDocumentIndex: (showDocumentIndex) => set({ showDocumentIndex }),
  autoCommitEnabled: true,
  autoCommitMinutes: 20,
  autoCommitMessage: 'update content automatically',
  setAutoCommitSettings: (enabled, minutes, message) => {
    if (typeof enabled === 'boolean' && Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440
      && message.trim().length > 0 && !message.includes('\0') && new TextEncoder().encode(message).length <= 4096) {
      set({ autoCommitEnabled: enabled, autoCommitMinutes: minutes, autoCommitMessage: message })
    }
  },
  autoSaveSeconds: 300,
  setAutoSaveSeconds: (seconds) => {
    if (Number.isInteger(seconds) && seconds >= 1 && seconds <= 86400) set({ autoSaveSeconds: seconds })
  },
  setZoom: (zoom) => { if (Number.isFinite(zoom)) set({ zoom: Math.max(0.25, Math.min(3, zoom)) }) },
  bleedMm: 3,
  marginMm: 15,
  rulerGuides: [],
  setRulerGuides: (rulerGuides) => set({ rulerGuides }),
  setPageSize: (pageSize) => set({ pageSize }),
  setColumns: (columns) => set({ columns }),
  setTheme: (theme) => set({ theme }),
  setViewMode: (viewMode) => set({ viewMode }),
}))
