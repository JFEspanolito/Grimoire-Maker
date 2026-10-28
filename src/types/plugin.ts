import type { ComponentType } from 'react'

export interface PluginCommand {
  id: string
  label: string
  run: () => void
}

export interface PluginPanel {
  id: string
  title: string
  component: ComponentType
}

export interface PluginSurface {
  kind: 'editor' | 'preview'
  zoom: number
  setZoom(value: number): void
}
export interface PluginSurfaceWidget {
  id: string
  title: string
  component: ComponentType<{ surface: PluginSurface }>
}
export interface PluginPageBehavior {
  id: string
  mount(element: HTMLElement, surface: PluginSurface): () => void
}

/** What a context action may know about the right-click that opened the editor menu. */
export interface PluginContextActionContext {
  /** The element under the pointer (or the focused element for a keyboard-opened menu). */
  target: Element | null
  /** Plain text of the current selection; empty when nothing is selected. */
  selectionText: string
  /** The document the click happened in, when it has a path. */
  path: string | null
  x: number
  y: number
}
/** One item a trusted plugin adds to the editor's single right-click menu. */
export interface PluginContextAction {
  id: string
  label: string
  /** Hides the item for a click it does not apply to; a throw counts as false. */
  when?(context: PluginContextActionContext): boolean
  run(context: PluginContextActionContext): void
}

/** Surface a plugin can use. It never receives app internals directly. */
export interface PluginApi {
  registerToolbar(panel: PluginPanel): void
  registerEditorTool(panel: PluginPanel): void
  registerPreviewToolbar(panel: PluginSurfaceWidget): void
  registerPageBehavior(behavior: PluginPageBehavior): void
  /** Adds an item to the editor's right-click menu (trusted plugins only). */
  registerContextAction(action: PluginContextAction): void
  addStyle(css: string): void
  onCleanup(dispose: () => void): void
  registerCommand(command: PluginCommand): void
  registerPanel(panel: PluginPanel): void
  /** Floating overlay rendered above the page canvas. */
  registerOverlay(overlay: PluginPanel): void
  getActiveBody(): string
  /** Inserts one editable, borderless movable group; placement defaults to Push text. */
  insertContent(markdown: string): void
  on(event: PluginEvent, handler: () => void): () => void
}

export type PluginEvent = 'document:changed' | 'document:saved' | 'page:changed'

export interface GrimoirePlugin {
  id: string
  name: string
  version: string
  activate(api: PluginApi): void
  deactivate?(): void
}
