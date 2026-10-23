import { useEffect, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { Toolbar } from './components/layout/Toolbar'
import { EditorCanvas } from './components/editor/EditorCanvas'
import { FileTree } from './components/sidebar/FileTree'
import { ResearchPanel } from './components/sidebar/ResearchPanel'
import { SnippetPalette } from './components/snippets/SnippetPalette'
import { TemplateCatalog } from './components/templates/TemplateCatalog'
import { PluginProvider } from './plugins/PluginContext'
import { useSettingsStore } from './stores/settingsStore'
import { useThemeStore } from './stores/themeStore'
import { useTemplateStore } from './stores/templateStore'
import { resolveTheme } from './lib/themes'
import { isTauri } from './hooks/useFileSystem'

export default function App() {
  const [editor, setEditor] = useState<Editor | null>(null)
  const theme = useSettingsStore((s) => s.theme)
  const themes = useThemeStore((s) => s.themes)
  const reloadThemes = useThemeStore((s) => s.reload)
  const reloadTemplates = useTemplateStore((s) => s.reload)

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
        <Toolbar />
        <div className="flex min-h-0 flex-1">
          <aside className="w-56 shrink-0 overflow-y-auto border-r border-white/10">
            <FileTree />
            <TemplateCatalog />
          </aside>
          <main className="min-w-0 flex-1 overflow-auto bg-neutral-800">
            <EditorCanvas onReady={setEditor} />
          </main>
          <aside className="flex w-64 shrink-0 flex-col overflow-y-auto border-l border-white/10">
            <SnippetPalette editor={editor} />
            <ResearchPanel />
          </aside>
        </div>
      </div>
    </PluginProvider>
  )
}
