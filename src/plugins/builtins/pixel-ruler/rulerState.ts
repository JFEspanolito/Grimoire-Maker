import { create } from 'zustand'

export const useRulerState = create<{ visible: boolean; toggle: () => void }>((set) => ({
  visible: false,
  toggle: () => set((s) => ({ visible: !s.visible })),
}))
