import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '../hooks/useFileSystem'

export async function openExternalUrl(url: string): Promise<void> {
  if (isTauri()) {
    try {
      await invoke('open_url', { url })
      return
    } catch {
      // fallback to browser window.open
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}
