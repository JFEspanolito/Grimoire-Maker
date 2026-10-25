import { useActivePath, usePageSettings, type GrimoirePlugin, type PluginSurface } from '@grimoire/plugin-api'
import { EDITOR_ZOOMS, PREVIEW_ZOOMS, mountWheelZoom } from './script'
import styles from './Zoom.module.css'

export function ZoomControl() {
  const { zoom, setZoom } = usePageSettings()
  const path = useActivePath()
  return <label className={styles.control}>Zoom
    <select aria-label="Editor zoom" value={zoom} disabled={!!path && !/\.md$/i.test(path)}
      onChange={event => setZoom(Number(event.target.value))}>
      {Array.from(new Set<number>([...EDITOR_ZOOMS, zoom])).sort((a, b) => a - b).map(value =>
        <option key={value} value={value}>{Math.round(value * 100)}%</option>)}
    </select>
  </label>
}

export function PreviewZoomControl({ surface }: { surface: PluginSurface }) {
  return <label className={styles.control}>Zoom
    <select aria-label="Preview zoom" value={surface.zoom} onChange={event => surface.setZoom(Number(event.target.value))}>
      {Array.from(new Set<number>([...PREVIEW_ZOOMS, surface.zoom])).sort((a, b) => a - b).map(value =>
        <option key={value} value={value}>{Math.round(value * 100)}%</option>)}
    </select>
  </label>
}

const zoom: GrimoirePlugin = {
  id: 'builtin.zoom', name: 'Zoom', version: '1.0.0',
  activate(api) {
    api.registerToolbar({ id: 'zoom.control', title: 'Zoom', component: ZoomControl })
    api.registerPreviewToolbar({ id: 'zoom.preview', title: 'Preview zoom', component: PreviewZoomControl })
    api.registerPageBehavior({ id: 'zoom.wheel', mount: mountWheelZoom })
  },
}
export default zoom
