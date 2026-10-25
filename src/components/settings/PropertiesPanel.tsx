import { useEditorState, type Editor } from '@tiptap/react'
import { sectionPosition } from '../editor/extensions/section'
import { useDocumentStore } from '../../stores/documentStore'
import { useTabStore } from '../../stores/tabStore'
import { useLayoutStore } from '../../stores/layoutStore'
import { currentPage, currentSheet } from '../../lib/pageSections'
import { ProjectSettings } from './ProjectSettings'
import styles from './ProjectSettings.module.css'

/** Columns of the page under the cursor. Sections are created and merged behind the scenes as pages differ. */
function PageColumns({ editor }: { editor: Editor }) {
  const page = useEditorState({
    editor,
    selector: ({ editor: e }) => ({ sheet: currentSheet(e)?.number ?? 1, columns: sectionPosition(e.state.doc, e.state.selection.from).columns }),
    equalityFn: (a, b) => !!a && !!b && a.sheet === b.sheet && a.columns === b.columns,
  })
  const key = useDocumentStore(state => state.document.path ?? '__untitled__')
  const total = useLayoutStore(state => state.sheets[key] ?? 1)
  const change = (value: string) => {
    const ref = currentPage(editor)
    if (!ref || ref.start === null) return
    editor.chain().focus().setPageColumns({ start: ref.start, next: ref.next, columns: value === '1' ? 1 : value === '2' ? 2 : null }).run()
  }
  return <label>Columns on this page ({page.sheet} of {Math.max(total, page.sheet)})
    <select aria-label="This page columns" value={page.columns ?? ''} onChange={event => change(event.target.value)}>
      <option value="">Default</option><option value="1">1 column</option><option value="2">2 columns</option>
    </select></label>
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
        <label>Default columns (project)<select aria-label="Page columns" value={document.frontmatter.columns === 1 || document.frontmatter.columns === 2 ? document.frontmatter.columns : ''}
          onChange={event => setFrontmatter({ columns: event.target.value === '1' ? 1 : event.target.value === '2' ? 2 : undefined })}>
          <option value="">Default</option><option value="1">1 column</option><option value="2">2 columns</option>
        </select></label>
        {editor && <PageColumns editor={editor} />}
        <p>Saved with this page using Save or Auto save.</p>
      </div> : <p>Select a Markdown page to edit its properties.</p>}
    </details>
  </div>
}
