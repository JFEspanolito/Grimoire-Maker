import { invoke, isTauri } from '@tauri-apps/api/core'
import { appConfigDir } from '@tauri-apps/api/path'
import type { PersistedSettings } from './appState'

export const LIBRARY_KIND = { PLUGINS: 'plugins', SNIPPETS: 'snippets', TEMPLATES: 'templates', THEMES: 'themes', LOGS: 'logs' } as const
export type LibraryKind = (typeof LIBRARY_KIND)[keyof typeof LIBRARY_KIND]
export interface LibraryPaths { plugins: string; snippets: string; templates: string; themes: string; logs: string }

/** Appearance and directory preferences share the native-owned setting.json file. */
export async function loadSettings(): Promise<PersistedSettings> {
  return isTauri() ? invoke<PersistedSettings>('load_settings') : {}
}

// Preserve renderer update order before the native shared settings/path lock.
let settingsQueue: Promise<void> = Promise.resolve()
export function saveSettings(settings: PersistedSettings): Promise<void> {
  if (!isTauri()) return Promise.resolve()
  const next = settingsQueue.then(() => invoke<void>('save_settings', { settings }))
  settingsQueue = next.catch(() => undefined)
  return next
}

/** Native resolution also restores the exact persisted directory scopes, independently of session restoration. */
export async function loadLibraryPaths(): Promise<LibraryPaths> {
  if (isTauri()) return invoke<LibraryPaths>('load_library_paths')
  const config = (await appConfigDir()).replaceAll('\\', '/').replace(/\/$/, '')
  return { plugins: `${config}/Mods/Plugins`, snippets: `${config}/Mods/Snippets`, templates: `${config}/Mods/Templates`, themes: `${config}/themes`, logs: `${config}/logs` }
}

/** The renderer cannot supply a source or destination. Native code owns selection, copying and publication. */
export async function changeLibraryPath(kind: LibraryKind): Promise<LibraryPaths | null> {
  if (!isTauri()) throw new Error('Directory preferences require the desktop application')
  return invoke<LibraryPaths | null>('change_library_path', { kind })
}
