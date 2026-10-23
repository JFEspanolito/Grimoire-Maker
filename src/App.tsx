import { useState } from 'react'
import type { Editor } from '@tiptap/react'
import { Toolbar } from './components/layout/Toolbar'
import { EditorCanvas } from './components/editor/EditorCanvas'
import { FileTree } from './components/sidebar/FileTree'
import { ResearchPanel } from './components/sidebar/ResearchPanel'
import { SnippetPalette } from './components/snippets/SnippetPalette'
import { TemplateCatalog } from './components/templates/TemplateCatalog'
import { PluginProvider } from './plugins/PluginContext'
import { useSettingsStore } from './stores/settingsStore'

export default function App() {
  const [editor, setEditor] = useState<Editor | null>(null)
  const theme = useSettingsStore((s) => s.theme)

  return (
    <PluginProvider>
      <div data-theme={theme} className="flex h-screen flex-col bg-neutral-900 text-neutral-100">
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
