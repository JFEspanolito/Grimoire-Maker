import { create } from 'zustand'
import { checkForAppUpdates, type UpdateInfo } from '../lib/versionCheck'

interface AppUpdateState {
  info: UpdateInfo | null
  checked: boolean
  checking: boolean
  checkUpdates: () => Promise<void>
}

export const useAppUpdateStore = create<AppUpdateState>((set, get) => ({
  info: null,
  checked: false,
  checking: false,
  checkUpdates: async () => {
    if (get().checking || get().checked) return
    set({ checking: true })
    try {
      const result = await checkForAppUpdates()
      set({ info: result, checked: true, checking: false })
    } catch {
      set({ info: null, checked: true, checking: false })
    }
  },
}))
