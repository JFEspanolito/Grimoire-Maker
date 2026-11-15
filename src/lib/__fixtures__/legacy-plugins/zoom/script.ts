import type { PluginSurface } from '@grimoire/plugin-api'

/** One ordered scale for the editor selector and its wheel navigation. */
export const EDITOR_ZOOMS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const
export const PREVIEW_ZOOMS = [0.4, 0.5, 0.6, 0.75, 1] as const

/** The host invokes the returned cleanup when a surface or plugin goes away. */
export function mountWheelZoom(element: HTMLElement, surface: PluginSurface): () => void {
  const steps = surface.kind === 'preview' ? PREVIEW_ZOOMS : EDITOR_ZOOMS
  const wheel = (event: WheelEvent) => {
    if (!event.ctrlKey || !event.deltaY || event.defaultPrevented || document.querySelector('dialog[open]')) return
    event.preventDefault()
    const next = event.deltaY < 0
      ? steps.find(value => value > surface.zoom)
      : steps.findLast(value => value < surface.zoom)
    if (next !== undefined) surface.setZoom(next)
  }
  element.addEventListener('wheel', wheel, { passive: false })
  return () => element.removeEventListener('wheel', wheel)
}
