import { invoke } from '@tauri-apps/api/core'

/** Native dialogs own every archive path; the renderer cannot supply arbitrary paths. */
export function packProject(): Promise<string | null> {
  return invoke('pack_project')
}

export function restoreProject(): Promise<string | null> {
  return invoke('restore_project_archive')
}
