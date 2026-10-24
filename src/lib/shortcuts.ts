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

export const ZOOM_SHORTCUTS = [
  { label: 'Zoom In', keys: ['Ctrl', 'Scroll Up'] },
  { label: 'Zoom Out', keys: ['Ctrl', 'Scroll Down'] },
] as const

export function fileShortcut(event: KeyboardEvent): keyof typeof FILE_SHORTCUTS | undefined {
  if (event.defaultPrevented || event.isComposing || event.altKey || event.shiftKey || !(event.ctrlKey || event.metaKey)) return
  return (Object.keys(FILE_SHORTCUTS) as (keyof typeof FILE_SHORTCUTS)[])
    .find(id => FILE_SHORTCUTS[id].key === event.key.toLowerCase())
}
