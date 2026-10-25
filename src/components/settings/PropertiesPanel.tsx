import { useDocumentStore } from '../../stores/documentStore'
import { useTabStore } from '../../stores/tabStore'
import { ProjectSettings } from './ProjectSettings'
import styles from './ProjectSettings.module.css'

export function PropertiesPanel() {
  const document = useDocumentStore(state => state.document)
  const setFrontmatter = useDocumentStore(state => state.setFrontmatter)
  const active = useTabStore(state => state.active)
  const markdown = !active || /\.md$/i.test(active)
  return <div className={styles.panel}>
    <details><summary>Project properties</summary><ProjectSettings /></details>
    <details><summary>Page properties</summary>
      {markdown ? <div className={styles.form}>
        <p>{document.path?.split(/[\\/]/).at(-1) ?? 'Unsaved page'} — applies to this Markdown file only.</p>
        <label>Page title<input aria-label="Page title" value={String(document.frontmatter.title ?? '')}
          onChange={event => setFrontmatter({ title: event.target.value })} /></label>
        <label>Page columns<select aria-label="Page columns" value={document.frontmatter.columns === 1 || document.frontmatter.columns === 2 ? document.frontmatter.columns : ''}
          onChange={event => setFrontmatter({ columns: event.target.value === '1' ? 1 : event.target.value === '2' ? 2 : undefined })}>
          <option value="">Default</option><option value="1">1 column</option><option value="2">2 columns</option>
        </select></label>
        <p>Saved with this page using Save or Auto save.</p>
      </div> : <p>Select a Markdown page to edit its properties.</p>}
    </details>
  </div>
}
