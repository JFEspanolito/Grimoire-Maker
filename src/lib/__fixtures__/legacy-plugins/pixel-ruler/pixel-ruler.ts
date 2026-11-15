import type { GrimoirePlugin } from '@grimoire/plugin-api'
import { RulerToggle } from './RulerToggle'
export { RulerToggle } from './RulerToggle'
import { useRulerState } from './rulerState'
import { RulerOverlay } from './RulerOverlay'
import { GuidesMenu } from './GuidesMenu'

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
