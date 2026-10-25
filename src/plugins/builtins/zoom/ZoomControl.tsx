import { EDITOR_ZOOMS } from '../../../lib/zoom'
import { useSettingsStore } from '../../../stores/settingsStore'
import { useTabStore } from '../../../stores/tabStore'
import styles from '../../../components/layout/Toolbar.module.css'

export function ZoomControl() {
  const { zoom, setZoom } = useSettingsStore()
  const active = useTabStore((state) => state.active)
  const documentTools = !active || /\.md$/i.test(active)

  return (
    <label className={styles.zoom}>Zoom
      <select
        aria-label="Editor zoom"
        value={zoom}
        disabled={!documentTools}
        onChange={(event) => setZoom(Number(event.target.value))}
      >
        {Array.from(new Set<number>([...EDITOR_ZOOMS, zoom]))
          .sort((a, b) => a - b)
          .map((value) => (
            <option key={value} value={value}>
              {Math.round(value * 100)}%
            </option>
          ))}
      </select>
    </label>
  )
}
