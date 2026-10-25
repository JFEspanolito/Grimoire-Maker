import { usePageSettings as useSettingsStore } from '@grimoire/plugin-api'

export const clamp = (value: number, maximum: number) => Math.round(Math.max(0, Math.min(value, maximum)) * 10) / 10
export const updateGuide = (id: string, positionMm: number) => {
  const store = useSettingsStore.getState()
  store.setRulerGuides(store.rulerGuides.map((guide) => guide.id === id ? { ...guide, positionMm } : guide))
}
export const removeGuide = (id: string) => {
  const store = useSettingsStore.getState()
  store.setRulerGuides(store.rulerGuides.filter((guide) => guide.id !== id))
}
