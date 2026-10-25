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

/** Surface a plugin can use. It never receives app internals directly. */
export interface PluginApi {
  registerToolbar(panel: PluginPanel): void
  registerEditorTool(panel: PluginPanel): void
  registerPreviewToolbar(panel: PluginSurfaceWidget): void
  registerPageBehavior(behavior: PluginPageBehavior): void
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
