import type {
  GrimoirePlugin,
  PluginApi,
  PluginCommand,
  PluginEvent,
  PluginPanel,
} from '../types/plugin'
import { create } from 'zustand'

interface PluginRegistry {
  plugins: GrimoirePlugin[]
  commands: PluginCommand[]
  panels: PluginPanel[]
  overlays: PluginPanel[]
}

export const usePluginRegistry = create<PluginRegistry>(() => ({
  plugins: [],
  commands: [],
  panels: [],
  overlays: [],
}))

type Handler = () => void
const listeners = new Map<PluginEvent, Set<Handler>>()

/** Host capabilities injected by the app so plugins never import stores. */
export interface PluginHost {
  getActiveBody(): string
  insertContent(markdown: string): void
}

let host: PluginHost = { getActiveBody: () => '', insertContent: () => {} }

export function setPluginHost(next: PluginHost): void {
  host = next
}

export function emitPluginEvent(event: PluginEvent): void {
  listeners.get(event)?.forEach((handler) => handler())
}

function createApi(): PluginApi {
  return {
    registerCommand: (command) =>
      usePluginRegistry.setState((s) => ({ commands: [...s.commands, command] })),
    registerPanel: (panel) => usePluginRegistry.setState((s) => ({ panels: [...s.panels, panel] })),
    registerOverlay: (overlay) =>
      usePluginRegistry.setState((s) => ({ overlays: [...s.overlays, overlay] })),
    getActiveBody: () => host.getActiveBody(),
    insertContent: (markdown) => host.insertContent(markdown),
    on: (event, handler) => {
      const set = listeners.get(event) ?? new Set<Handler>()
      set.add(handler)
      listeners.set(event, set)
      return () => set.delete(handler)
    },
  }
}

export function registerPlugin(plugin: GrimoirePlugin): void {
  if (usePluginRegistry.getState().plugins.some((p) => p.id === plugin.id)) return
  usePluginRegistry.setState((s) => ({ plugins: [...s.plugins, plugin] }))
  plugin.activate(createApi())
}
