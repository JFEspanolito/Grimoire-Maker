import { invoke, isTauri } from '@tauri-apps/api/core'
import { configRoot } from './configRoot'
import type { PersistedSettings } from './appState'

export const LIBRARY_KIND = { PLUGINS: 'plugins', SNIPPETS: 'snippets', TEMPLATES: 'templates', THEMES: 'themes', LOGS: 'logs' } as const
export type LibraryKind = (typeof LIBRARY_KIND)[keyof typeof LIBRARY_KIND]
export interface LibraryPaths { plugins: string; snippets: string; templates: string; themes: string; logs: string }
/** Libraries still in the folders the desktop app chose for this run (portable `Data` or the installer's content root). */
export interface ManagedFolders { plugins?: boolean; snippets?: boolean; templates?: boolean }
/** What `load_library_paths` returns. The browser fallback has no native layout and reports none. */
export interface LoadedLibraryPaths extends LibraryPaths { managed?: ManagedFolders }

/** Appearance and directory preferences share the native-owned setting.json file. */
export async function loadSettings(): Promise<PersistedSettings> {
  return isTauri() ? invoke<PersistedSettings>('load_settings') : {}
}

// Preserve renderer update order before the native shared settings/path lock.
let settingsQueue: Promise<void> = Promise.resolve()
export function saveSettings(settings: PersistedSettings): Promise<void> {
  if (!isTauri()) return Promise.resolve()
  const next = settingsQueue.then(async () => {
    try {
      await invoke<void>('save_settings', { settings })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('unknown field') || msg.includes('customFonts') || msg.includes('marginMm')) {
        const copy = { ...settings }
        delete copy.customFonts
        delete copy.marginMm
        await invoke<void>('save_settings', { settings: copy })
        return
      }
      throw err
    }
  })
  settingsQueue = next.catch(() => undefined)
  return next
}

/**
 * Native resolution also restores the exact persisted directory scopes, independently of session restoration.
 * The browser fallback below mirrors the native Normal-mode defaults only; portable and installer layouts are native-only.
 */
export async function loadLibraryPaths(): Promise<LoadedLibraryPaths> {
  if (isTauri()) return invoke<LoadedLibraryPaths>('load_library_paths')
  const config = (await configRoot()).replaceAll('\\', '/').replace(/\/$/, '')
  return { plugins: `${config}/Mods/Plugins`, snippets: `${config}/Mods/Snippets`, templates: `${config}/Mods/Templates`, themes: `${config}/themes`, logs: `${config}/logs` }
}

/** The renderer cannot supply a source or destination. Native code owns selection, copying and publication. */
export async function changeLibraryPath(kind: LibraryKind): Promise<LibraryPaths | null> {
  if (!isTauri()) throw new Error('Directory preferences require the desktop application')
  return invoke<LibraryPaths | null>('change_library_path', { kind })
}
