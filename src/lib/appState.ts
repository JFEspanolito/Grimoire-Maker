import { appConfigDir, join } from '@tauri-apps/api/path'
import { exists, mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { useSettingsStore } from '../stores/settingsStore'
import type { PageSizeId, ThemeId } from '../types/document'
import { saveSettings } from './preferences'
import { useSessionStore } from '../stores/sessionStore'

export interface PersistedSettings {
  pageSize?: PageSizeId
  columns?: 1 | 2
  theme?: ThemeId
}

/** What survives a restart. Stored as `state.json` in the app config folder. */
export interface AppState {
  lastWorkspace: string | null
  /** Most recent first. The Rust side only re-grants fs access to folders listed here. */
  recentWorkspaces: string[]
  lastFile: string | null
  /** Legacy copy retained for safe migration; new preferences live in setting.json. */
  settings: PersistedSettings
}

const MAX_RECENT = 10

const emptyState = (): AppState => ({
  lastWorkspace: null,
  recentWorkspaces: [],
  lastFile: null,
  settings: {},
})

const asPath = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

async function statePath(): Promise<string> {
  const dir = await appConfigDir()
  if (!(await exists(dir))) await mkdir(dir, { recursive: true })
  return (await join(dir, 'state.json')).replaceAll('\\', '/')
}

/** A missing or corrupt file means "nothing remembered", never an error. */
export async function loadAppState(): Promise<AppState> {
  try {
    const path = await statePath()
    if (!(await exists(path))) return emptyState()
    const raw = JSON.parse(await readTextFile(path)) as Partial<AppState>
    return {
      lastWorkspace: asPath(raw.lastWorkspace),
      recentWorkspaces: Array.isArray(raw.recentWorkspaces)
        ? raw.recentWorkspaces.map(asPath).filter((p): p is string => p !== null)
        : [],
      lastFile: asPath(raw.lastFile),
      settings: typeof raw.settings === 'object' && raw.settings ? raw.settings : {},
    }
  } catch {
    return emptyState()
  }
}

// Read-modify-write is serialised so two quick updates cannot overwrite each other.
let queue: Promise<unknown> = Promise.resolve()

/** Runs native state mutations after pending frontend writes, without letting later writes overtake them. */
export function withAppStateLock<T>(operation: () => Promise<T>): Promise<T> {
  const next = queue.then(operation)
  queue = next.catch(() => undefined)
  return next
}

export function updateAppState(change: (state: AppState) => AppState): Promise<AppState> {
  return withAppStateLock(async () => {
    const state = change(await loadAppState())
    await writeTextFile(await statePath(), JSON.stringify(state, null, 2))
    return state
  })
}

export const rememberWorkspace =
  (root: string) =>
  (state: AppState): AppState => ({
    ...state,
    lastWorkspace: root,
    lastFile: state.lastWorkspace === root ? state.lastFile : null,
    recentWorkspaces: [root, ...state.recentWorkspaces.filter((p) => p !== root)].slice(0, MAX_RECENT),
  })

export const forgetWorkspace =
  (root: string) =>
  (state: AppState): AppState => ({
    ...state,
    lastWorkspace: state.lastWorkspace === root ? null : state.lastWorkspace,
    lastFile: state.lastWorkspace === root ? null : state.lastFile,
    recentWorkspaces: state.recentWorkspaces.filter((p) => p !== root),
  })

/** Saves page setup whenever it changes; returns the unsubscribe function. */
export function watchSettings(): () => void {
  return useSettingsStore.subscribe((s, prev) => {
    if (s.pageSize === prev.pageSize && s.columns === prev.columns && s.theme === prev.theme) return
    void saveSettings({ pageSize: s.pageSize, columns: s.columns, theme: s.theme }).catch((error: unknown) => {
      useSessionStore.getState().setWorkspaceError(`Could not save preferences: ${error instanceof Error ? error.message : String(error)}`)
    })
  })
}
