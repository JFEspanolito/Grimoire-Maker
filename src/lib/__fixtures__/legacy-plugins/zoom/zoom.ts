import type { GrimoirePlugin } from '@grimoire/plugin-api'
import { mountWheelZoom } from './script'
import { ZoomControl, PreviewZoomControl } from './ZoomControls'
export { ZoomControl, PreviewZoomControl } from './ZoomControls'

const zoom: GrimoirePlugin = {
  id: 'builtin.zoom', name: 'Zoom', version: '1.0.0',
  activate(api) {
    api.registerToolbar({ id: 'zoom.control', title: 'Zoom', component: ZoomControl })
    api.registerPreviewToolbar({ id: 'zoom.preview', title: 'Preview zoom', component: PreviewZoomControl })
    api.registerPageBehavior({ id: 'zoom.wheel', mount: mountWheelZoom })
  },
}
export default zoom
