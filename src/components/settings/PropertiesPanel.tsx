import { useEditorState, type Editor } from '@tiptap/react'
import { sectionPosition } from '../editor/extensions/section'
import { useDocumentStore } from '../../stores/documentStore'
import { useTabStore } from '../../stores/tabStore'
import { ProjectSettings } from './ProjectSettings'
import styles from './ProjectSettings.module.css'

/** Columns for the part of the page the cursor is in; the file default applies where a section says Default. */
function SectionColumns({ editor }: { editor: Editor }) {
  const section = useEditorState({
    editor,
    selector: ({ editor: e }) => sectionPosition(e.state.doc, e.state.selection.from),
    equalityFn: (a, b) => !!a && !!b && a.index === b.index && a.count === b.count && a.columns === b.columns,
  })
  return <>
    <label>Columns in this section ({section.index} of {section.count})
      <select aria-label="Section columns" value={section.columns ?? ''}
        onChange={event => editor.commands.setSectionColumns(event.target.value === '1' ? 1 : event.target.value === '2' ? 2 : null)}>
        <option value="">Default</option><option value="1">1 column</option><option value="2">2 columns</option>
      </select></label>
    <div className={styles.creditLinks}>
      <button type="button" onClick={() => editor.chain().focus().insertSectionBreak().run()}>New page</button>
      <button type="button" disabled={section.index === 1} onClick={() => editor.chain().focus().mergeSectionWithPrevious().run()}>Merge with previous</button>
    </div>
  </>
}

export function PropertiesPanel({ expanded = false, editor = null }: { expanded?: boolean; editor?: Editor | null }) {
  const document = useDocumentStore(state => state.document)
  const setFrontmatter = useDocumentStore(state => state.setFrontmatter)
  const active = useTabStore(state => state.active)
  const markdown = !active || /\.md$/i.test(active)
  return <div className={styles.panel}>
    <details open={expanded || undefined}><summary>Project properties</summary><ProjectSettings /></details>
    <details open={expanded || undefined}><summary>Page properties</summary>
      {markdown ? <div className={styles.form}>
        <p>{document.path?.split(/[\\/]/).at(-1) ?? 'Unsaved page'} — applies to this Markdown file only.</p>
        <label>Default columns (whole file)<select aria-label="Page columns" value={document.frontmatter.columns === 1 || document.frontmatter.columns === 2 ? document.frontmatter.columns : ''}
          onChange={event => setFrontmatter({ columns: event.target.value === '1' ? 1 : event.target.value === '2' ? 2 : undefined })}>
          <option value="">Default</option><option value="1">1 column</option><option value="2">2 columns</option>
        </select></label>
        {editor && <SectionColumns editor={editor} />}
        <p>Saved with this page using Save or Auto save.</p>
      </div> : <p>Select a Markdown page to edit its properties.</p>}
    </details>
  </div>
}
