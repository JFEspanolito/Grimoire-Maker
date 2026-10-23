import { create } from 'zustand'

interface SessionState {
  /** Recently opened workspace folders, most recent first. */
  recentWorkspaces: string[]
  setRecentWorkspaces: (paths: string[]) => void
}

export const useSessionStore = create<SessionState>((set) => ({
  recentWorkspaces: [],
  setRecentWorkspaces: (recentWorkspaces) => set({ recentWorkspaces }),
}))
