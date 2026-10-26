import { create } from 'zustand'

/** Measured layout of each open document, published by the page view for the status bar. */
export const useLayoutStore = create<{
  sheets: Record<string, number>
  setSheets: (key: string, count: number) => void
}>((set) => ({
  sheets: {},
  setSheets: (key, count) => set((state) => state.sheets[key] === count ? state : { sheets: { ...state.sheets, [key]: count } }),
}))
