/** Shared by the application bindings and the Preferences reference. */
export const FILE_SHORTCUTS = {
  saveAll: { label: 'Save All', key: 's' },
  openFile: { label: 'Open File', key: 'o' },
  createNewFile: { label: 'New File', key: 'n' },
} as const

export const EDITOR_SHORTCUTS = [
  { label: 'Undo', keys: ['Ctrl', 'Z'] },
  { label: 'Redo', keys: ['Ctrl', 'Shift', 'Z'] },
  { label: 'Bold', keys: ['Ctrl', 'B'] },
  { label: 'Italic', keys: ['Ctrl', 'I'] },
  { label: 'Underline', keys: ['Ctrl', 'U'] },
] as const

export const EXPLORER_SHORTCUTS = [
  { label: 'Rename selected file (Files)', keys: ['F2'] },
] as const

export const ZOOM_SHORTCUTS = [
  { label: 'Zoom In', keys: ['Ctrl', 'Scroll Up'] },
  { label: 'Zoom Out', keys: ['Ctrl', 'Scroll Down'] },
] as const

export function fileShortcut(event: KeyboardEvent): keyof typeof FILE_SHORTCUTS | undefined {
  if (event.defaultPrevented || event.isComposing || event.altKey || event.shiftKey || !(event.ctrlKey || event.metaKey)) return
  return (Object.keys(FILE_SHORTCUTS) as (keyof typeof FILE_SHORTCUTS)[])
    .find(id => FILE_SHORTCUTS[id].key === event.key.toLowerCase())
}

export const FIND_SHORTCUTS = [
  { label: 'Find and Replace', keys: ['Ctrl', 'F'] },
  { label: 'Replace (focus the Replace field)', keys: ['Ctrl', 'H'] },
  { label: 'Next match (panel open)', keys: ['F3'] },
  { label: 'Previous match (panel open)', keys: ['Shift', 'F3'] },
  { label: 'Close Find and Replace', keys: ['Esc'] },
] as const

export type FindShortcut = 'find' | 'replace' | 'next' | 'previous'

/** Ctrl+F, Ctrl+H, F3 and Shift+F3. Whether the panel is open is the caller's business. */
export function findShortcut(event: KeyboardEvent): FindShortcut | undefined {
  if (event.defaultPrevented || event.isComposing || event.altKey) return
  if (event.key === 'F3' && !event.ctrlKey && !event.metaKey) return event.shiftKey ? 'previous' : 'next'
  if (event.shiftKey || !(event.ctrlKey || event.metaKey)) return
  const key = event.key.toLowerCase()
  return key === 'f' ? 'find' : key === 'h' ? 'replace' : undefined
}
