import { useActivePath, type GrimoirePlugin } from '@grimoire/plugin-api'
import { useRulerState } from './rulerState'
import { RulerOverlay } from './RulerOverlay'
import { GuidesMenu } from './GuidesMenu'
import styles from './Ruler.module.css'

export function RulerToggle() {
  const { visible, toggle } = useRulerState()
  const path = useActivePath()
  return <button type="button" className={styles.toggle} aria-label="Ruler" aria-pressed={visible}
    disabled={!!path && !/\.md$/i.test(path)} title="Show or hide page measurements in editing view"
    onClick={toggle}>Ruler</button>
}

const ruler: GrimoirePlugin = {
  id: 'builtin.pixel-ruler', name: 'Ruler', version: '1.0.0',
  activate(api) {
    useRulerState.setState({ visible: false })
    api.registerToolbar({ id: 'pixel-ruler.toggle', title: 'Ruler', component: RulerToggle })
    api.registerEditorTool({ id: 'pixel-ruler.guides', title: 'Guides', component: GuidesMenu })
    api.registerOverlay({ id: 'pixel-ruler.overlay', title: 'Ruler', component: RulerOverlay })
    api.onCleanup(() => useRulerState.setState({ visible: false }))
  },
}
export default ruler
