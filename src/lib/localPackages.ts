import { invoke } from '@tauri-apps/api/core'

export interface LocalPackageInfo {
  folder: string
  id: string
  version: string
  fingerprint: string
  /** The bytes differ from the version the registry knew before this sync. */
  changed: boolean
}
export interface LocalPackageError { folder: string; message: string }
export interface LocalPackageSync { packages: LocalPackageInfo[]; errors: LocalPackageError[] }

/** The folder name a package mod lives in (the last segment of its path). */
export const folderName = (path: string) => path.replaceAll('\\', '/').replace(/\/+$/, '').split('/').at(-1) ?? ''
export const sameFolder = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/**
 * Asks the native side to validate every package folder in the Plugins directory and record it as a
 * local plugin. Returns null outside the desktop application, where there is no native side.
 */
export async function syncLocalPackages(pluginsDir: string): Promise<LocalPackageSync | null> {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return null
  return invoke<LocalPackageSync>('sync_local_plugin_packages', { pluginsDir })
}
