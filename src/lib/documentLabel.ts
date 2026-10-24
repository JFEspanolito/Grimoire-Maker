/** Markdown is a storage detail; other file types and directory names remain explicit. */
export function documentLabel(name: string, isDirectory = false): string {
  return isDirectory ? name : name.replace(/\.md$/i, '')
}
