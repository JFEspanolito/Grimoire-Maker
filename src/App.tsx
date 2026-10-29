import { PropertiesPanel } from './components/settings/PropertiesPanel'
import { useProjectStore } from './stores/projectStore'
import { useEffect, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { Toolbar } from './components/layout/Toolbar'
import { DocumentWorkspace } from './components/layout/DocumentWorkspace'
import { FileTree } from './components/sidebar/FileTree'
import { SnippetPalette } from './components/snippets/SnippetPalette'
import { ExportPageSnippetButton } from './components/snippets/ExportPageSnippetButton'
import { ToastHost } from './components/mods/ToastHost'
import { TemplateCatalog } from './components/templates/TemplateCatalog'
import { PluginProvider } from './plugins/PluginContext'
import { useSettingsStore } from './stores/settingsStore'
import { useSessionStore } from './stores/sessionStore'
import { useThemeStore } from './stores/themeStore'
import { useTemplateStore } from './stores/templateStore'
import { resolveTheme } from './lib/themes'
import { isTauri, useFileSystem } from './hooks/useFileSystem'
import { watchSettings } from './lib/appState'
import { useTabStore } from './stores/tabStore'
import { useUnsavedClose } from './hooks/useUnsavedClose'
import { MenuBar } from './components/layout/MenuBar'
import { NewProjectDialog } from './components/project/NewProjectDialog'
import { FindReplaceDialog } from './components/editor/FindReplaceDialog'
import { FormulaDialog } from './components/editor/FormulaDialog'
import styles from './App.module.css'
import { VersionControlPanel } from './components/version-control/VersionControlPanel'
import { useDocumentStore } from './stores/documentStore'
import { useAutoSave } from './hooks/useAutoSave'
import { useAutoCommit } from './hooks/useAutoCommit'
import { useRepositoryStatus } from './hooks/useRepositoryStatus'
import { PanelResizeHandle } from './components/layout/PanelResizeHandle'

export default function App() {
  useUnsavedClose()
  const [editor, setEditor] = useState<Editor | null>(null)
  const visiblePanels = useSettingsStore((s) => s.panels)
  const [sidebarWidth, setSidebarWidth] = useState(224)
  const [snippetsWidth, setSnippetsWidth] = useState(256)
  const sidebarCollapsed = !visiblePanels.files && !visiblePanels.templates && !visiblePanels.git
  const [sessionReady, setSessionReady] = useState(false)
  const [startupProjectOpen, setStartupProjectOpen] = useState(false)
  useAutoSave(sessionReady)
  useAutoCommit(sessionReady)
  const workspace = useDocumentStore((s) => s.workspaceRoot)
  useEffect(() => { if (workspace) void useProjectStore.getState().load(workspace) }, [workspace])
  const repository = useRepositoryStatus(workspace)
  const uncommitted = repository.status?.isRepository ? repository.status.entries.length : 0
  const hasUnsavedChanges = useDocumentStore((s) => s.document.dirty || Object.values(s.buffers).some((document) => document.dirty))
  const theme = useSettingsStore((s) => s.theme)
  const themes = useThemeStore((s) => s.themes)
  const reloadThemes = useThemeStore((s) => s.reload)
  const reloadTemplates = useTemplateStore((s) => s.reload)
  const { restoreSession, createProject, openWorkspace } = useFileSystem()
  const activeTab = useTabStore((s) => s.active)
  const hasTabs = useTabStore((s) => s.paths.length > 0)
  const activeEditor = hasTabs && (!activeTab || !/\.md$/i.test(activeTab)) ? null : editor
  const togglePanel = useSettingsStore((s) => s.togglePanel)

  // Reopen last session first, then start saving page-setup changes: subscribing
  // earlier would overwrite the saved settings with the defaults.
  useEffect(() => {
    if (!isTauri()) return
    let cancelled = false
    let unwatch = () => {}
    void restoreSession()
      .then(() => {
        if (cancelled) return
        setSessionReady(true)
        if (!useDocumentStore.getState().workspaceRoot && !useSessionStore.getState().workspaceError) {
          setStartupProjectOpen(true)
        }
      })
      .catch((e) => useSessionStore.getState().setWorkspaceError(`Could not restore session: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => {
        if (!cancelled) unwatch = watchSettings()
      })
    return () => {
      cancelled = true
      unwatch()
    }
  }, [restoreSession])

  // Mods live in a folder: scan on start and whenever the window regains focus,
  // so a theme edited in an external editor shows up without restarting.
  useEffect(() => {
    if (!isTauri()) return
    // Templates go second: a package theme must not take an id a mod theme already holds.
    const reload = async () => {
      await reloadThemes()
      await reloadTemplates()
    }
    void reload()
    const onFocus = () => void reload()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [reloadThemes, reloadTemplates])

  return (
    <PluginProvider>
      <div data-theme={resolveTheme(theme, themes)} className={styles.shell}>
        <MenuBar visiblePanels={visiblePanels} onTogglePanel={togglePanel} editor={activeEditor} />
        <Toolbar />
        <div className={styles.body}>
            <aside id="project-sidebar" data-tour="project-sidebar" style={sidebarCollapsed ? undefined : { width: sidebarWidth }} className={`${styles.sidebar} ${sidebarCollapsed ? styles.rail : ''}`}>
              <div className={styles.explorer}>
              {visiblePanels.files && <FileTree />}
              {visiblePanels.templates && <TemplateCatalog />}
              </div>
              <div className={styles.sourceControl}>
                <button type="button" className={styles.gitToggle} aria-expanded={visiblePanels.git} aria-controls="source-control-panel"
                  onClick={() => togglePanel('git')} title={repository.error ? `Git status unavailable: ${repository.error}` : 'Source control'}>
                  Git{(visiblePanels.files || visiblePanels.templates || visiblePanels.git) && ' · Source control'}
                  {uncommitted > 0 && <span className={styles.gitMarker} aria-label={`${uncommitted} uncommitted changes`} title={`${uncommitted} uncommitted changes`}>●</span>}
                  {repository.error && <span className={styles.gitMarker} aria-label="Git status unavailable">?</span>}
                </button>
                {visiblePanels.git && <div id="source-control-panel" className={styles.gitPanel}>
                  <VersionControlPanel workspace={workspace} hasUnsavedChanges={hasUnsavedChanges} />
                </div>}
              </div>
            </aside>
          {!sidebarCollapsed && <PanelResizeHandle label="Resize Files panel" controls="project-sidebar"
            width={sidebarWidth} otherWidth={snippetsWidth} direction={1} onResize={setSidebarWidth} />}
          <main data-tour="editor-workspace" className={styles.main}>
            <DocumentWorkspace editor={activeEditor} onReady={setEditor} />
          </main>
          <PanelResizeHandle label="Resize Snippets and Properties panel" controls="snippets-sidebar"
            width={snippetsWidth} otherWidth={sidebarCollapsed ? 40 : sidebarWidth} direction={-1} onResize={setSnippetsWidth} />
          <aside id="snippets-sidebar" data-tour="snippets-sidebar" style={{ width: snippetsWidth }} className={styles.snippets}>
            <div className={styles.explorer}>{visiblePanels.snippets && <SnippetPalette editor={activeEditor} />}</div>
            <div className={styles.sourceControl}>
              <button type="button" className={styles.gitToggle} aria-expanded={visiblePanels.properties} aria-controls="properties-panel"
                onClick={() => togglePanel('properties')}>Properties</button>
              {visiblePanels.properties && <div id="properties-panel" className={styles.gitPanel}><PropertiesPanel editor={activeEditor} /><ExportPageSnippetButton /></div>}
            </div>
          </aside>
        </div>
        <FindReplaceDialog editor={activeEditor} />
        <FormulaDialog />
        {startupProjectOpen && !workspace && (
          <NewProjectDialog
            required
            onCreate={createProject}
            onOpenExisting={openWorkspace}
            onClose={() => setStartupProjectOpen(false)}
          />
        )}
        <ToastHost />
      </div>
    </PluginProvider>
  )
}
