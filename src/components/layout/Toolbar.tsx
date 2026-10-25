import { useDocumentStore } from '../../stores/documentStore'
import { usePluginRegistry } from '../../plugins/plugin-manager'
import { ProjectName } from './ProjectName'
import styles from './Toolbar.module.css'
import { useRulerState } from '../../plugins/builtins/pixel-ruler/rulerState'
import { ZoomControl } from '../../plugins/builtins/zoom'
import { useTabStore } from '../../stores/tabStore'
import { useModStore } from '../../stores/modStore'

/** Project identity and editor tools; view settings live in the menus. */
export function Toolbar() {
  const dirty = useDocumentStore((state) => state.document.dirty)
  const commands = usePluginRegistry((state) => state.commands)
  const rulerVisible = useRulerState((state) => state.visible)
  const active = useTabStore((state) => state.active)
  const mods = useModStore((state) => state.mods)
  const zoomEnabled = mods.find((mod) => mod.id === 'Plugins/zoom')?.enabled ?? true
  const rulerEnabled = mods.find((mod) => mod.id === 'Plugins/pixel-ruler')?.enabled ?? true
  const documentTools = !active || /\.md$/i.test(active)
  const visibleCommands = commands.filter((command) => command.id !== 'pixel-ruler.toggle' || rulerEnabled)
  return (
    <header className={styles.toolbar}>
      <div className={styles.group} role="group" aria-label="Current project">
        <ProjectName />
        {dirty && <span className={styles.dirty} title="Unsaved document changes">•</span>}
      </div>
      <div className={styles.tools} role="group" aria-label="Editor tools">
        {zoomEnabled && <ZoomControl />}
        {visibleCommands.map((command) => <button key={command.id} className={styles.button}
          disabled={command.id === 'pixel-ruler.toggle' && !documentTools}
          aria-pressed={command.id === 'pixel-ruler.toggle' ? rulerVisible : undefined}
          title={command.id === 'pixel-ruler.toggle' ? 'Show or hide page measurements in editing view' : undefined}
          onClick={command.run}>{command.label}</button>)}
      </div>
    </header>
  )
}
