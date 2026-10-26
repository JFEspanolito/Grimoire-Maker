import { create } from 'zustand'

/** Host-owned visibility of the page measurements; guides live in the settings store. */
interface RulerState {
  visible: boolean
  toggle: () => void
  reset: () => void
}

export const useRulerStore = create<RulerState>((set) => ({
  visible: false,
  toggle: () => set((state) => ({ visible: !state.visible })),
  reset: () => set({ visible: false }),
}))
