import { invoke } from '@tauri-apps/api/core'
import { MOD_KIND, type ModEntry } from './modCatalog'
import { deleteUserTheme } from './themeEditor'

/** Last segment of a mod's path, whichever separator it uses. */
function leafName(path: string): string {
  return path.replaceAll('\\', '/').replace(/\/+$/, '').split('/').at(-1) ?? ''
}

/**
 * Permanently removes the files of a mod from disk. Themes go through the existing theme command;
 * every folder-based kind goes through the native `delete_mod` command, which re-validates the name
 * and the folder itself (the name sent here is only a selector, never a path).
 */
export async function deleteModFiles(mod: ModEntry): Promise<void> {
  if (mod.kind === MOD_KIND.THEMES) {
    await deleteUserTheme(leafName(mod.folder).replace(/\.css$/i, ''))
    return
  }
  await invoke<void>('delete_mod', { kind: mod.kind, name: leafName(mod.folder) })
}
