import { useActivePath } from '@grimoire/plugin-api'
import { useRulerState } from './rulerState'
import styles from './Ruler.module.css'

export function RulerToggle() {
  const { visible, toggle } = useRulerState()
  const path = useActivePath()
  return <button type="button" className={styles.toggle} aria-label="Ruler" aria-pressed={visible}
    disabled={!!path && !/\.md$/i.test(path)} title="Show or hide page measurements in editing view"
    onClick={toggle}>Ruler</button>
}
