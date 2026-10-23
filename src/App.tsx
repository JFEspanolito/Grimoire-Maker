import { useEffect, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { Toolbar } from './components/layout/Toolbar'
import { DocumentWorkspace } from './components/layout/DocumentWorkspace'
import { FileTree } from './components/sidebar/FileTree'
import { SnippetPalette } from './components/snippets/SnippetPalette'
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
import styles from './App.module.css'
import { VersionControlPanel } from './components/version-control/VersionControlPanel'
import { useDocumentStore } from './stores/documentStore'

export default function App() {
  useUnsavedClose()
  const [editor, setEditor] = useState<Editor | null>(null)
  const [visiblePanels, setVisiblePanels] = useState({ files: true, templates: true, snippets: true })
  const [gitOpen, setGitOpen] = useState(false)
  const workspace = useDocumentStore((s) => s.workspaceRoot)
  const hasUnsavedChanges = useDocumentStore((s) => s.document.dirty || Object.values(s.buffers).some((document) => document.dirty))
  const theme = useSettingsStore((s) => s.theme)
  const themes = useThemeStore((s) => s.themes)
  const reloadThemes = useThemeStore((s) => s.reload)
  const reloadTemplates = useTemplateStore((s) => s.reload)
  const { restoreSession } = useFileSystem()
  const activeTab = useTabStore((s) => s.active)
  const hasTabs = useTabStore((s) => s.paths.length > 0)
  const activeEditor = hasTabs && !activeTab ? null : editor
  const togglePanel = (panel: keyof typeof visiblePanels) =>
    setVisiblePanels((current) => ({ ...current, [panel]: !current[panel] }))

  // Reopen last session first, then start saving page-setup changes: subscribing
  // earlier would overwrite the saved settings with the defaults.
  useEffect(() => {
    if (!isTauri()) return
    let cancelled = false
    let unwatch = () => {}
    void restoreSession()
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
        <MenuBar visiblePanels={visiblePanels} onTogglePanel={togglePanel} />
        <Toolbar visiblePanels={visiblePanels} onTogglePanel={togglePanel} />
        <div className={styles.body}>
            <aside className={`${styles.sidebar} ${!visiblePanels.files && !visiblePanels.templates && !gitOpen ? styles.rail : ''}`}>
              <div className={styles.explorer}>
              {visiblePanels.files && <FileTree />}
              {visiblePanels.templates && <TemplateCatalog />}
              </div>
              <div className={styles.sourceControl}>
                <button type="button" className={styles.gitToggle} aria-expanded={gitOpen} aria-controls="source-control-panel"
                  onClick={() => setGitOpen((open) => !open)} title="Source control">Git{(visiblePanels.files || visiblePanels.templates || gitOpen) && ' · Source control'}</button>
                {gitOpen && <div id="source-control-panel" className={styles.gitPanel}>
                  <VersionControlPanel workspace={workspace} hasUnsavedChanges={hasUnsavedChanges} />
                </div>}
              </div>
            </aside>
          <main className={styles.main}>
            <DocumentWorkspace editor={activeEditor} onReady={setEditor} />
          </main>
          {visiblePanels.snippets && (
            <aside className={styles.snippets}>
              <SnippetPalette editor={activeEditor} />
            </aside>
          )}
        </div>
      </div>
    </PluginProvider>
  )
}
