import type { ExternalPluginEntry, ToolbarItem } from '../../lib/externalPlugins'
import { reportError } from '../../lib/errorLogging'
import { GuidesMenu } from '../../components/ruler/GuidesMenu'
import { RulerOverlay } from '../../components/ruler/RulerOverlay'
import { useRulerStore } from '../../stores/rulerStore'
import type { PluginApi } from '../../types/plugin'
import { createExternalToolbar, createPreviewZoom } from './ExternalToolbar'
import { mountWheelZoom } from './wheelZoom'

const ZOOM = ['editor:zoom:write']
const RULER = ['editor:geometry:read', 'editor:guides:read', 'editor:guides:write']
const GUIDES = ['editor:guides:read', 'editor:guides:write']

/** Defence in depth: the native side validated the manifest, the host checks the grant again. */
function covered(entry: ExternalPluginEntry, needed: string[], what: string): boolean {
  const missing = needed.filter((permission) => !entry.permissions.includes(permission))
  if (!missing.length) return true
  reportError('plugin.external.contribution', new Error(`${entry.id}: ${what} skipped, missing ${missing.join(', ')}`))
  return false
}

/** Runs one registration; a failure skips that contribution and keeps the rest working. */
function attempt(entry: ExternalPluginEntry, what: string, register: () => void) {
  try { register() } catch (error) { reportError('plugin.external.contribution', new Error(`${entry.id}: ${what}: ${error instanceof Error ? error.message : String(error)}`)) }
}

/**
 * Registers everything a plugin declares as data, rendered by the host from host stores.
 * All of it goes through one plugin registration so a single disposer removes it.
 */
export function registerHostContributions(
  api: PluginApi,
  entry: ExternalPluginEntry,
  send: (command: string, value: string | null) => void,
): void {
  const prefix = `external.${entry.id}`
  const toolbar = entry.toolbar ?? []
  const main: ToolbarItem[] = []
  for (const item of toolbar) {
    const bound = item.bind === 'zoom' || item.bind === 'surfaceZoom'
    if (bound && !covered(entry, ZOOM, `toolbar ${item.id}`)) continue
    if (item.slot === 'preview') {
      if (item.bind !== 'surfaceZoom') { reportError('plugin.external.contribution', new Error(`${entry.id}: toolbar ${item.id} skipped, unsupported preview control`)); continue }
      attempt(entry, `toolbar ${item.id}`, () => api.registerPreviewToolbar({ id: `${prefix}.${item.id}`, title: item.label, component: createPreviewZoom(item) }))
    } else if (item.bind === 'surfaceZoom') {
      reportError('plugin.external.contribution', new Error(`${entry.id}: toolbar ${item.id} skipped, surfaceZoom needs the preview slot`))
    } else {
      main.push(item)
    }
  }
  if (main.length) {
    attempt(entry, 'toolbar', () => api.registerToolbar({ id: `${prefix}.toolbar`, title: entry.id, component: createExternalToolbar(main, send) }))
  }
  if (main.some((item) => item.bind === 'rulerVisible') || (entry.overlays ?? []).some((item) => item.type === 'ruler')) {
    api.onCleanup(() => useRulerStore.getState().reset())
  }
  for (const behavior of entry.behaviors ?? []) {
    if (behavior.type !== 'wheelZoom' || !covered(entry, ZOOM, `behavior ${behavior.id}`)) continue
    const steps = { editor: behavior.editorSteps, preview: behavior.previewSteps }
    attempt(entry, `behavior ${behavior.id}`, () =>
      api.registerPageBehavior({ id: `${prefix}.${behavior.id}`, mount: (element, surface) => mountWheelZoom(element, surface, steps) }))
  }
  for (const overlay of entry.overlays ?? []) {
    if (overlay.type !== 'ruler' || !covered(entry, RULER, `overlay ${overlay.id}`)) continue
    attempt(entry, `overlay ${overlay.id}`, () => api.registerOverlay({ id: `${prefix}.${overlay.id}`, title: 'Ruler', component: RulerOverlay }))
  }
  for (const tool of entry.tools ?? []) {
    if (tool.type !== 'guidesMenu' || !covered(entry, GUIDES, `tool ${tool.id}`)) continue
    attempt(entry, `tool ${tool.id}`, () => api.registerEditorTool({ id: `${prefix}.${tool.id}`, title: tool.label, component: GuidesMenu }))
  }
}
