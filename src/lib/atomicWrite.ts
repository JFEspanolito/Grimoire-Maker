import { invoke } from '@tauri-apps/api/core'
import { rename, writeTextFile } from '@tauri-apps/plugin-fs'

/** Hidden sibling a document is written to before it replaces the original. */
export function savingPath(path: string): string {
  const slash = path.lastIndexOf('/')
  return `${path.slice(0, slash)}/.${path.slice(slash + 1)}.saving.md`
}

/**
 * Writes beside the target and renames over it, so a crash or a concurrent Git read never sees a
 * half-written document. The hidden name stays out of the file tree and search, which skip
 * dotfiles; Rust grants exactly that sibling, because on macOS and Linux a folder grant never
 * covers hidden files.
 */
export async function writeTextFileAtomically(path: string, text: string): Promise<void> {
  const temporary = savingPath(path)
  try {
    await invoke('prepare_document_save', { path })
    await writeTextFile(temporary, text)
  } catch {
    // Some documents are granted alone, without their folder (for example one saved directly in the
    // home folder); the sibling is refused there, so write in place as before.
    await writeTextFile(path, text)
    return
  }
  // If the rename fails the target is untouched and the hidden sibling keeps the newer text for
  // recovery; the app has no file-removal permission, by design.
  await rename(temporary, path)
}
