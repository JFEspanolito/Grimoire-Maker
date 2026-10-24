import type { GrimoirePlugin } from '../../../types/plugin'
import { useRulerState } from './rulerState'
import { RulerOverlay } from './RulerOverlay'

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
