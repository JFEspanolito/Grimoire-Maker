import { create } from 'zustand'
import { isTauri } from '@tauri-apps/api/core'
import { invoke } from '@tauri-apps/api/core'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { checkForAppUpdates, type UpdateInfo } from '../lib/versionCheck'
import { useDocumentStore } from './documentStore'

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'upToDate'
  | 'downloading'
  | 'readyToRestart'
  | 'error'

export interface UpdateProgress {
  totalBytes: number | null
  downloadedBytes: number
  percent: number | null
}

export interface AppUpdateState {
  status: UpdateStatus
  info: UpdateInfo | null
  isManualCheck: boolean
  isPortable: boolean
  currentVersion: string
  availableVersion: string | null
  releaseNotes: string | null
  releaseDate: string | null
  releaseUrl: string | null
  errorMessage: string | null
  progress: UpdateProgress | null
  dialogOpen: boolean
  confirmingUnsavedRestart: boolean
  postponedVersions: string[]
  updateHandle: Update | null

  // Actions
  checkForUpdates: (manual?: boolean) => Promise<void>
  checkUpdates: (manual?: boolean) => Promise<void>
  startDownloadAndInstall: () => Promise<void>
  restartApp: (_saveAll?: () => Promise<boolean | undefined>) => Promise<boolean>
  confirmSaveAndRestart: (saveAll: () => Promise<boolean | undefined>) => Promise<boolean>
  cancelUnsavedRestart: () => void
  postponeUpdate: () => void
  openDialog: () => void
  closeDialog: () => void
  resetStatus: () => void
}

export async function detectPortableMode(): Promise<boolean> {
  if (!isTauri()) return false
  try {
    return await invoke<boolean>('is_portable')
  } catch {
    return false
  }
}

export function hasUnsavedDocuments(): boolean {
  const state = useDocumentStore.getState()
  return Boolean(state.document.dirty || Object.values(state.buffers).some((doc) => doc.dirty))
}

export const useAppUpdateStore = create<AppUpdateState>((set, get) => {
  const checkAction = async (manual = false) => {
    const current = get()
    // Prevent simultaneous or redundant checks while checking or downloading
    if (current.status === 'checking' || current.status === 'downloading') return

    set({
      status: 'checking',
      isManualCheck: manual,
      errorMessage: null,
      confirmingUnsavedRestart: false,
    })

    try {
      const isPortable = await detectPortableMode()
      set({ isPortable })

      if (isTauri() && !isPortable) {
        // Native Tauri v2 auto-updater flow
        let update: Update | null = null
        try {
          update = await check({ timeout: 15000 })
        } catch (checkError) {
          // Fall back to GitHub API check if updater manifest check fails
          const fallback = await checkForAppUpdates()
          if (fallback?.hasUpdate) {
            const isPostponed = get().postponedVersions.includes(fallback.latestVersion)
            set({
              status: 'available',
              info: fallback,
              currentVersion: fallback.currentVersion,
              availableVersion: fallback.latestVersion,
              releaseNotes: null,
              releaseDate: null,
              releaseUrl: fallback.releaseUrl,
              updateHandle: null,
              dialogOpen: manual || !isPostponed,
            })
            return
          }
          throw checkError
        }

        if (update) {
          const isPostponed = get().postponedVersions.includes(update.version)
          const releaseUrl = `https://github.com/JFEspanolito/Grimoire-Maker/releases/tag/v${update.version.replace(/^v/, '')}`
          set({
            status: 'available',
            info: {
              hasUpdate: true,
              currentVersion: update.currentVersion,
              latestVersion: update.version,
              releaseUrl,
            },
            currentVersion: update.currentVersion,
            availableVersion: update.version,
            releaseNotes: update.body || null,
            releaseDate: update.date || null,
            releaseUrl,
            updateHandle: update,
            dialogOpen: manual || !isPostponed,
          })
        } else {
          set({
            status: 'upToDate',
            info: null,
            updateHandle: null,
            dialogOpen: manual,
          })
        }
      } else {
        // Portable mode or Web fallback: use GitHub Releases check
        const info: UpdateInfo | null = await checkForAppUpdates()
        if (info) {
          set({ currentVersion: info.currentVersion })
          if (info.hasUpdate) {
            const isPostponed = get().postponedVersions.includes(info.latestVersion)
            set({
              status: 'available',
              info,
              availableVersion: info.latestVersion,
              releaseNotes: null,
              releaseDate: null,
              releaseUrl: info.releaseUrl,
              updateHandle: null,
              dialogOpen: manual || !isPostponed,
            })
          } else {
            set({
              status: 'upToDate',
              info,
              updateHandle: null,
              dialogOpen: manual,
            })
          }
        } else {
          if (manual) {
            set({
              status: 'error',
              info: null,
              errorMessage: 'Could not connect to update server. Please check your internet connection.',
              dialogOpen: true,
            })
          } else {
            set({ status: 'idle' })
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (manual) {
        set({
          status: 'error',
          info: null,
          errorMessage: message || 'Failed to check for updates.',
          dialogOpen: true,
        })
      } else {
        set({ status: 'idle', errorMessage: message })
      }
    }
  }

  return {
    status: 'idle',
    info: null,
    isManualCheck: false,
    isPortable: false,
    currentVersion: '',
    availableVersion: null,
    releaseNotes: null,
    releaseDate: null,
    releaseUrl: null,
    errorMessage: null,
    progress: null,
    dialogOpen: false,
    confirmingUnsavedRestart: false,
    postponedVersions: [],
    updateHandle: null,

    checkForUpdates: checkAction,
    checkUpdates: checkAction,

  startDownloadAndInstall: async () => {
    const { updateHandle, status } = get()
    if (!updateHandle || status === 'downloading') return

    set({
      status: 'downloading',
      errorMessage: null,
      progress: { totalBytes: null, downloadedBytes: 0, percent: null },
    })

    let totalBytes: number | null = null
    let downloadedBytes = 0

    try {
      await updateHandle.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          totalBytes = event.data.contentLength ?? null
          set({
            progress: {
              totalBytes,
              downloadedBytes: 0,
              percent: totalBytes ? 0 : null,
            },
          })
        } else if (event.event === 'Progress') {
          downloadedBytes += event.data.chunkLength
          const percent = totalBytes && totalBytes > 0
            ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100))
            : null
          set({
            progress: {
              totalBytes,
              downloadedBytes,
              percent,
            },
          })
        } else if (event.event === 'Finished') {
          set({
            status: 'readyToRestart',
            progress: {
              totalBytes,
              downloadedBytes: totalBytes ?? downloadedBytes,
              percent: 100,
            },
          })
        }
      })
      set({ status: 'readyToRestart' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      set({
        status: 'error',
        errorMessage: `Download or installation failed: ${message}`,
      })
    }
  },

  restartApp: async (_saveAll) => {
    if (hasUnsavedDocuments()) {
      set({ confirmingUnsavedRestart: true })
      return false
    }

    try {
      if (isTauri()) {
        await relaunch()
      } else {
        window.location.reload()
      }
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      set({
        status: 'error',
        errorMessage: `Failed to restart application: ${message}`,
      })
      return false
    }
  },

  confirmSaveAndRestart: async (saveAll) => {
    try {
      const saved = await saveAll()
      if (saved === false) {
        set({
          confirmingUnsavedRestart: false,
          status: 'error',
          errorMessage: 'Could not save unsaved documents. Restart aborted to protect your work.',
        })
        return false
      }

      if (hasUnsavedDocuments()) {
        set({
          confirmingUnsavedRestart: false,
          status: 'error',
          errorMessage: 'Unsaved documents remain dirty. Restart aborted to protect your work.',
        })
        return false
      }

      set({ confirmingUnsavedRestart: false })
      if (isTauri()) {
        await relaunch()
      } else {
        window.location.reload()
      }
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      set({
        confirmingUnsavedRestart: false,
        status: 'error',
        errorMessage: `Failed to save or restart: ${message}`,
      })
      return false
    }
  },

  cancelUnsavedRestart: () => {
    set({ confirmingUnsavedRestart: false })
  },

  postponeUpdate: () => {
    const { availableVersion, postponedVersions, updateHandle } = get()
    const nextPostponed = availableVersion && !postponedVersions.includes(availableVersion)
      ? [...postponedVersions, availableVersion]
      : postponedVersions

    if (updateHandle) {
      void updateHandle.close().catch(() => undefined)
    }

    set({
      dialogOpen: false,
      postponedVersions: nextPostponed,
    })
  },

    openDialog: () => set({ dialogOpen: true }),
    closeDialog: () => set({ dialogOpen: false, confirmingUnsavedRestart: false }),
    resetStatus: () => set({
      status: 'idle',
      errorMessage: null,
      progress: null,
      confirmingUnsavedRestart: false,
    }),
  }
})
