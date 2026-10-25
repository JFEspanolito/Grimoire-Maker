import type { GrimoirePlugin } from '../../../types/plugin'
import { ZoomControl } from './ZoomControl'

export { ZoomControl }

export const zoomPlugin: GrimoirePlugin = {
  id: 'builtin.zoom',
  name: 'Zoom',
  version: '0.1.0',
  activate() {
    // Toolbar renders ZoomControl when the Zoom plugin is enabled.
  },
}
