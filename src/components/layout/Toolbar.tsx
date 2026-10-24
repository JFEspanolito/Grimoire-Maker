import { useDocumentStore } from '../../stores/documentStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { usePluginRegistry } from '../../plugins/plugin-manager'
import { PAGE_SIZES, type PageSizeId } from '../../types/document'
import { ProjectName } from './ProjectName'
import styles from './Toolbar.module.css'

/** Document identity and page setup; application actions live in the menus. */
export function Toolbar() {
  const { pageSize, columns, setPageSize, setColumns } = useSettingsStore()
  const dirty = useDocumentStore((state) => state.document.dirty)
  const commands = usePluginRegistry((state) => state.commands)
  return (
    <header className={styles.toolbar}>
      <div className={styles.group} role="group" aria-label="Current project">
        <ProjectName />
        {dirty && <span className={styles.dirty} title="Unsaved document changes">•</span>}
      </div>
      <div className={styles.group} role="group" aria-label="Page setup">
        <label className={styles.field}>Page size
          <select aria-label="Page size" value={pageSize} onChange={(event) => setPageSize(event.target.value as PageSizeId)}>
            {Object.values(PAGE_SIZES).map((size) => <option key={size.id} value={size.id}>{size.label}</option>)}
          </select>
        </label>
        <label className={styles.field}>Columns
          <select aria-label="Columns" value={columns} onChange={(event) => setColumns(Number(event.target.value) as 1 | 2)}>
            <option value={1}>1</option>
            <option value={2}>2</option>
          </select>
        </label>
      </div>
      {commands.length > 0 && <div className={styles.tools} role="group" aria-label="Editor tools">
        {commands.map((command) => <button key={command.id} className={styles.button} onClick={command.run}>{command.label}</button>)}
      </div>}
    </header>
  )
}
