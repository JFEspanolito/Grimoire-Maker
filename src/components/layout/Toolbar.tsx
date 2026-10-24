import { useDocumentStore } from '../../stores/documentStore'
import { usePluginRegistry } from '../../plugins/plugin-manager'
import { ProjectName } from './ProjectName'
import styles from './Toolbar.module.css'
import { useRulerState } from '../../plugins/builtins/pixel-ruler/rulerState'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTabStore } from '../../stores/tabStore'

/** Project identity and editor tools; view settings live in the menus. */
export function Toolbar() {
  const dirty = useDocumentStore((state) => state.document.dirty)
  const commands = usePluginRegistry((state) => state.commands)
  const rulerVisible = useRulerState((state) => state.visible)
  const { zoom, setZoom, viewMode } = useSettingsStore()
  const active = useTabStore((state) => state.active)
  const documentTools = !active || /\.md$/i.test(active)
  return (
    <header className={styles.toolbar}>
      <div className={styles.group} role="group" aria-label="Current project">
        <ProjectName />
        {dirty && <span className={styles.dirty} title="Unsaved document changes">•</span>}
      </div>
      <div className={styles.tools} role="group" aria-label="Editor tools">
        <label className={styles.zoom}>Zoom
          <select aria-label="Editor zoom" value={zoom} disabled={!documentTools || viewMode !== 'edit'} onChange={(event) => setZoom(Number(event.target.value))}>
            {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3].map((value) => <option key={value} value={value}>{Math.round(value * 100)}%</option>)}
          </select>
        </label>
        {commands.map((command) => <button key={command.id} className={styles.button}
          disabled={command.id === 'pixel-ruler.toggle' && !documentTools}
          aria-pressed={command.id === 'pixel-ruler.toggle' ? rulerVisible && viewMode === 'edit' : undefined}
          title={command.id === 'pixel-ruler.toggle' ? 'Show or hide page measurements in editing view' : undefined}
          onClick={command.run}>{command.label}</button>)}
      </div>
    </header>
  )
}
