import { useEffect, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { Toolbar } from './components/layout/Toolbar'
import { DocumentTabs } from './components/layout/DocumentTabs'
import { EditorCanvas } from './components/editor/EditorCanvas'
import { EditorToolbar } from './components/editor/EditorToolbar'
import { PagePreview } from './components/editor/PagePreview'
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

export default function App() {
  const [editor, setEditor] = useState<Editor | null>(null)
  const [visiblePanels, setVisiblePanels] = useState({ files: true, templates: true, snippets: true })
  const theme = useSettingsStore((s) => s.theme)
  const viewMode = useSettingsStore((s) => s.viewMode)
  const themes = useThemeStore((s) => s.themes)
  const reloadThemes = useThemeStore((s) => s.reload)
  const reloadTemplates = useTemplateStore((s) => s.reload)
  const { restoreSession } = useFileSystem()
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
      <div data-theme={resolveTheme(theme, themes)} className="flex h-screen flex-col bg-neutral-900 text-neutral-100">
        <Toolbar visiblePanels={visiblePanels} onTogglePanel={togglePanel} />
        <div className="flex min-h-0 flex-1">
          {(visiblePanels.files || visiblePanels.templates) && (
            <aside className="w-56 shrink-0 overflow-y-auto border-r border-white/10">
              {visiblePanels.files && <FileTree />}
              {visiblePanels.templates && <TemplateCatalog />}
            </aside>
          )}
          <main className="flex min-w-0 flex-1 flex-col bg-neutral-800">
            <DocumentTabs />
            {viewMode === 'edit' && <EditorToolbar editor={editor} />}
            {/* Stays mounted while previewing: the preview paginates a copy of its content. */}
            <div className={viewMode === 'edit' ? 'min-h-0 flex-1 overflow-auto' : 'hidden'}>
              <EditorCanvas onReady={setEditor} />
            </div>
            {viewMode !== 'edit' && <PagePreview mode={viewMode} />}
          </main>
          {visiblePanels.snippets && (
            <aside className="flex w-64 shrink-0 flex-col overflow-y-auto border-l border-white/10">
              <SnippetPalette editor={editor} />
            </aside>
          )}
        </div>
      </div>
    </PluginProvider>
  )
}
