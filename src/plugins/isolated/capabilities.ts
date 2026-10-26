import { useSettingsStore } from '../../stores/settingsStore'
import { PAGE_SIZES } from '../../types/document'
import type { HostCapabilities } from './bridge'
import type { Topic } from './protocol'

const round = (value: number) => Math.round(value * 10) / 10

/**
 * The only editor surface an isolated plugin can reach. Values leave the host as plain numbers and
 * short ids; no document text, file path or store object is ever handed over.
 */
export function hostCapabilities(): HostCapabilities {
  const state = () => useSettingsStore.getState()
  return {
    getZoom: () => state().zoom,
    setZoom: (value) => state().setZoom(value),
    getGeometry: () => {
      const size = PAGE_SIZES[state().pageSize]
      return { pageWidthMm: size.widthMm, pageHeightMm: size.heightMm, zoom: state().zoom }
    },
    listGuides: () => state().rulerGuides.map(({ id, axis, positionMm }) => ({ id, axis, positionMm })),
    addGuide: (axis, positionMm) => {
      const size = PAGE_SIZES[state().pageSize]
      const limit = axis === 'row' ? size.heightMm : size.widthMm
      const id = `external-${crypto.randomUUID()}`
      state().setRulerGuides([...state().rulerGuides, { id, axis, positionMm: round(Math.min(positionMm, limit)) }])
      return id
    },
    removeGuide: (id) => {
      const before = state().rulerGuides
      const after = before.filter((guide) => guide.id !== id)
      if (after.length === before.length) return false
      state().setRulerGuides(after)
      return true
    },
  }
}

/** Calls `notify` when a topic's data changed; returns the unsubscribe function. */
export function watchHost(notify: (topic: Topic) => void): () => void {
  return useSettingsStore.subscribe((state, previous) => {
    if (state.zoom !== previous.zoom) { notify('zoom'); notify('geometry') }
    else if (state.pageSize !== previous.pageSize) notify('geometry')
    if (state.rulerGuides !== previous.rulerGuides) notify('guides')
  })
}
