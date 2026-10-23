import type { Editor } from '@tiptap/react'
import { useDocumentStore } from '../../stores/documentStore'
import { useTabStore } from '../../stores/tabStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { EditorCanvas } from '../editor/EditorCanvas'
import { EditorToolbar } from '../editor/EditorToolbar'
import { PagePreview } from '../editor/PagePreview'
import { DocumentTabs } from './DocumentTabs'
import styles from './DocumentWorkspace.module.css'

export function DocumentWorkspace({ editor, onReady }: { editor: Editor | null; onReady: (editor: Editor) => void }) {
  const { paths, panes, split, activePane, focusPane } = useTabStore()
  const viewMode = useSettingsStore((s) => s.viewMode)
  const activePath = useDocumentStore((s) => s.document.path)
  const focus = (pane: 0 | 1) => {
    focusPane(pane)
    const path = useTabStore.getState().panes[pane]
    if (path) useDocumentStore.getState().activate(path)
  }
  // Each open file owns a mounted editor, retaining selection, undo and scroll state.
  const documents: (string | null)[] = paths.length ? paths : [null]
  return <>
    <DocumentTabs />
    {viewMode === 'edit' && <EditorToolbar editor={editor} />}
    <div className={styles.workspace} data-split={split} hidden={viewMode !== 'edit'}>
      {documents.map((path) => {
        const pane = panes[1] === path && split ? 1 : 0
        const visible = panes[pane] === path || (path === null && paths.length === 0)
        const active = visible && pane === activePane && path === activePath
        return <section key={path ?? '__untitled__'} className={styles.pane} hidden={!visible}
          style={{ gridColumn: pane + 1 }} data-active-editor={active} aria-label={`Editor ${pane + 1}`}
          onPointerDownCapture={() => focus(pane)} onFocusCapture={() => focus(pane)}>
          <EditorCanvas path={path} active={active} onReady={onReady} />
        </section>
      })}
      {([0, 1] as const).filter((pane) => (pane === 0 || split) && !panes[pane] && paths.length > 0).map((pane) =>
        <button key={`empty-${pane}`} className={styles.empty} style={{ gridColumn: pane + 1 }} onClick={() => focusPane(pane)}>
          Select this view, then open a file or choose a tab.
        </button>)}
    </div>
    {viewMode !== 'edit' && <PagePreview mode={viewMode} />}
  </>
}
