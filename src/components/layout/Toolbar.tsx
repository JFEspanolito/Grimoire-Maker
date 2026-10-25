import { useDocumentStore } from '../../stores/documentStore'
import { usePluginRegistry } from '../../plugins/plugin-manager'
import { ProjectName } from './ProjectName'
import styles from './Toolbar.module.css'
import { PluginSlot } from '../../plugins/PluginSlot'

/** Project identity and editor tools; view settings live in the menus. */
export function Toolbar() {
  const dirty = useDocumentStore((state) => state.document.dirty)
  const commands = usePluginRegistry((state) => state.commands)
  return (
    <header className={styles.toolbar}>
      <div className={styles.group} role="group" aria-label="Current project">
        <ProjectName />
        {dirty && <span className={styles.dirty} title="Unsaved document changes">•</span>}
      </div>
      <div className={styles.tools} role="group" aria-label="Editor tools">
        <PluginSlot slot="toolbar" />
        {commands.map((command) => <button key={command.id} className={styles.button}
          onClick={command.run}>{command.label}</button>)}
      </div>
    </header>
  )
}
