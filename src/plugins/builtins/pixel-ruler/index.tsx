import type { GrimoirePlugin } from '../../../types/plugin'
import { useRulerState } from './rulerState'
import { RulerOverlay } from './RulerOverlay'
import { useSettingsStore } from '../../../stores/settingsStore'

export const pixelRuler: GrimoirePlugin = {
  id: 'builtin.pixel-ruler',
  name: 'Pixel & Print Ruler',
  version: '0.1.0',
  activate(api) {
    api.registerCommand({
      id: 'pixel-ruler.toggle',
      label: 'Ruler',
      run: () => {
        const settings = useSettingsStore.getState()
        if (settings.viewMode !== 'edit') {
          settings.setViewMode('edit')
          useRulerState.setState({ visible: true })
        } else useRulerState.getState().toggle()
      },
    })
    api.registerOverlay({ id: 'pixel-ruler.overlay', title: 'Ruler', component: RulerOverlay })
  },
}
