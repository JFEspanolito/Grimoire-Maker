import { useSettingsStore } from '../../../stores/settingsStore'
import { PAGE_SIZES } from '../../../types/document'
import type { GrimoirePlugin } from '../../../types/plugin'
import { create } from 'zustand'

/** Reference plugin: a toggleable overlay showing margin and bleed guides. */
const useRulerState = create<{ visible: boolean; toggle: () => void }>((set) => ({
  visible: false,
  toggle: () => set((s) => ({ visible: !s.visible })),
}))

function RulerOverlay() {
  const visible = useRulerState((s) => s.visible)
  const { pageSize, marginMm, bleedMm } = useSettingsStore()
  if (!visible) return null

  const { widthMm, heightMm, label } = PAGE_SIZES[pageSize]
  return (
    <div className="pointer-events-none absolute inset-0 z-20" aria-hidden>
      <div
        className="absolute border border-dashed border-sky-500"
        style={{ inset: `${marginMm}mm` }}
      />
      <div
        className="absolute border border-dashed border-rose-500"
        style={{ inset: `${bleedMm}mm` }}
      />
      <span className="absolute left-2 top-2 rounded bg-black/70 px-1 text-[10px] text-white">
        {label} · {widthMm}×{heightMm} mm · margin {marginMm} · bleed {bleedMm}
      </span>
    </div>
  )
}

export const pixelRuler: GrimoirePlugin = {
  id: 'builtin.pixel-ruler',
  name: 'Pixel & Print Ruler',
  version: '0.1.0',
  activate(api) {
    api.registerCommand({
      id: 'pixel-ruler.toggle',
      label: 'Ruler',
      run: () => useRulerState.getState().toggle(),
    })
    api.registerOverlay({ id: 'pixel-ruler.overlay', title: 'Ruler', component: RulerOverlay })
  },
}
