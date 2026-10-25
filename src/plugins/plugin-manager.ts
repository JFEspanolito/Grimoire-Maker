import type {
  GrimoirePlugin, PluginApi, PluginCommand, PluginEvent, PluginPanel,
  PluginPageBehavior, PluginSurfaceWidget,
} from '../types/plugin'
import { create } from 'zustand'

interface PluginRegistry {
  plugins: GrimoirePlugin[]
  commands: PluginCommand[]
  panels: PluginPanel[]
  overlays: PluginPanel[]
  toolbar: PluginPanel[]
  editorTools: PluginPanel[]
  previewToolbar: PluginSurfaceWidget[]
  pageBehaviors: PluginPageBehavior[]
}

export const usePluginRegistry = create<PluginRegistry>(() => ({
  plugins: [], commands: [], panels: [], overlays: [], toolbar: [],
  editorTools: [], previewToolbar: [], pageBehaviors: [],
}))
type Handler = () => void
const listeners = new Map<PluginEvent, Set<Handler>>()
const disposers = new Map<string, Handler>()
const CONTRIBUTIONS = ['commands', 'panels', 'overlays', 'toolbar', 'editorTools', 'previewToolbar', 'pageBehaviors'] as const
type ContributionKey = (typeof CONTRIBUTIONS)[number]

export interface PluginHost {
  getActiveBody(): string
  insertContent(markdown: string): void
}
let host: PluginHost = { getActiveBody: () => '', insertContent: () => {} }
export function setPluginHost(next: PluginHost): void { host = next }
export function emitPluginEvent(event: PluginEvent): void {
  for (const handler of [...(listeners.get(event) ?? [])]) {
    try { handler() } catch (error) { console.error(`Plugin event ${event} failed`, error) }
  }
}

export function unregisterPlugin(id: string): void { disposers.get(id)?.() }

/** Contributions and registered disposers belong to one activation, never to the catalog. */
export function registerPlugin(plugin: GrimoirePlugin): () => void {
  if (disposers.has(plugin.id)) return () => {}
  let active = true
  const cleanups: Handler[] = []
  const owned = new Set<unknown>()
  const assertActive = () => { if (!active) throw new Error(`Plugin ${plugin.id} is inactive`) }
  const add = <K extends ContributionKey>(key: K, value: PluginRegistry[K][number]) => {
    assertActive()
    if (!value || typeof value.id !== 'string' || !value.id) throw new Error(`Invalid ${key} contribution`)
    if (usePluginRegistry.getState()[key].some(item => item.id === value.id)) throw new Error(`Duplicate ${key} id: ${value.id}`)
    owned.add(value)
    usePluginRegistry.setState(state => ({ [key]: [...state[key], value] }) as Partial<PluginRegistry>)
  }
  const dispose = () => {
    if (!active) return
    active = false
    disposers.delete(plugin.id)
    usePluginRegistry.setState(state => ({
      plugins: state.plugins.filter(item => item !== plugin),
      ...Object.fromEntries(CONTRIBUTIONS.map(key => [key, state[key].filter(item => !owned.has(item))])),
    }))
    const errors: unknown[] = []
    for (const cleanup of [...cleanups].reverse()) {
      try { cleanup() } catch (error) { errors.push(error) }
    }
    try { plugin.deactivate?.() } catch (error) { errors.push(error) }
    if (errors.length) throw new AggregateError(errors, `Plugin ${plugin.id} cleanup failed`)
  }
  const api: PluginApi = {
    registerCommand: value => add('commands', value),
    registerPanel: value => add('panels', value),
    registerOverlay: value => add('overlays', value),
    registerToolbar: value => add('toolbar', value),
    registerEditorTool: value => add('editorTools', value),
    registerPreviewToolbar: value => add('previewToolbar', value),
    registerPageBehavior: value => add('pageBehaviors', value),
    getActiveBody: () => host.getActiveBody(),
    insertContent: markdown => { assertActive(); host.insertContent(markdown) },
    addStyle: css => {
      assertActive()
      const style = document.createElement('style')
      style.dataset.pluginStyle = plugin.id
      style.textContent = css
      document.head.append(style)
      cleanups.push(() => style.remove())
    },
    onCleanup: cleanup => { assertActive(); cleanups.push(cleanup) },
    on: (event, handler) => {
      assertActive()
      const handlers = listeners.get(event) ?? new Set<Handler>()
      const ownedHandler = () => handler()
      handlers.add(ownedHandler)
      listeners.set(event, handlers)
      const unsubscribe = () => { handlers.delete(ownedHandler); if (!handlers.size) listeners.delete(event) }
      cleanups.push(unsubscribe)
      return unsubscribe
    },
  }
  disposers.set(plugin.id, dispose)
  usePluginRegistry.setState(state => ({ plugins: [...state.plugins, plugin] }))
  try {
    const result: unknown = plugin.activate(api)
    if (result && typeof result === 'object' && 'then' in result) {
      void Promise.resolve(result).catch(() => undefined)
      throw new Error('Plugin activate must be synchronous; register async cleanup explicitly')
    }
  } catch (error) {
    try { dispose() } catch (cleanupError) { console.error('Plugin rollback cleanup failed', cleanupError) }
    throw error
  }
  return dispose
}
