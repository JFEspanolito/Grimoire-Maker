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

/** Surface a plugin can use. It never receives app internals directly. */
export interface PluginApi {
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
