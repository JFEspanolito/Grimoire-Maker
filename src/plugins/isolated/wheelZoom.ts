import type { PluginSurface } from '../../types/plugin'

/**
 * Host-side Ctrl+wheel stepping for a declared `wheelZoom` behavior. Steps arrive as whole
 * percentages from the manifest; the host owns the listener and the zoom state.
 */
export function mountWheelZoom(
  element: HTMLElement,
  surface: PluginSurface,
  steps: { editor: readonly number[]; preview: readonly number[] },
): () => void {
  const stops = (surface.kind === 'preview' ? steps.preview : steps.editor).map((percent) => percent / 100)
  const wheel = (event: WheelEvent) => {
    if (!event.ctrlKey || !event.deltaY || event.defaultPrevented || document.querySelector('dialog[open]')) return
    event.preventDefault()
    const next = event.deltaY < 0
      ? stops.find((value) => value > surface.zoom)
      : stops.findLast((value) => value < surface.zoom)
    if (next !== undefined) surface.setZoom(next)
  }
  element.addEventListener('wheel', wheel, { passive: false })
  return () => element.removeEventListener('wheel', wheel)
}
