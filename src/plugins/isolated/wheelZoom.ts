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
  const target = element.closest<HTMLElement>('[data-active-editor]') ?? element
  const wheel = (event: WheelEvent) => {
    const modal = document.querySelector('dialog[open]:not([data-find-panel])')
    if (!event.ctrlKey || !event.deltaY || event.defaultPrevented || element.closest('[hidden]') || (modal && !modal.contains(element))) return
    event.preventDefault()
    const next = event.deltaY < 0
      ? stops.find((value) => value > surface.zoom)
      : stops.findLast((value) => value < surface.zoom)
    if (next !== undefined) surface.setZoom(next)
  }
  target.addEventListener('wheel', wheel, { passive: false })
  return () => target.removeEventListener('wheel', wheel)
}
