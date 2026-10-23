import { useDocumentStore } from '../../stores/documentStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { usePluginRegistry } from '../../plugins/plugin-manager'
import { useFileSystem } from '../../hooks/useFileSystem'
import { usePrint } from '../../hooks/usePrint'
import { PAGE_SIZES, type PageSizeId, type ThemeId } from '../../types/document'

const btn = 'rounded px-2 py-1 text-sm hover:bg-white/10'

export function Toolbar() {
  const { openFile, saveFile } = useFileSystem()
  const exportPdf = usePrint()
  const { pageSize, columns, theme, setPageSize, setColumns, setTheme } = useSettingsStore()
  const title = useDocumentStore((s) => s.document.frontmatter.title)
  const dirty = useDocumentStore((s) => s.document.dirty)
  const commands = usePluginRegistry((s) => s.commands)

  return (
    <header className="flex items-center gap-2 border-b border-white/10 px-3 py-1.5">
      <strong className="mr-2 text-sm">
        {title ?? 'Untitled'}
        {dirty && ' •'}
      </strong>
      <button className={btn} onClick={() => openFile()}>
        Open
      </button>
      <button className={btn} onClick={saveFile}>
        Save
      </button>
      <button className={btn} onClick={exportPdf}>
        Export PDF
      </button>
      <span className="mx-2 h-4 w-px bg-white/20" />
      <select
        aria-label="Page size"
        value={pageSize}
        onChange={(e) => setPageSize(e.target.value as PageSizeId)}
        className="rounded bg-transparent text-sm"
      >
        {Object.values(PAGE_SIZES).map((p) => (
          <option key={p.id} value={p.id} className="text-black">
            {p.label}
          </option>
        ))}
      </select>
      <select
        aria-label="Columns"
        value={columns}
        onChange={(e) => setColumns(Number(e.target.value) as 1 | 2)}
        className="rounded bg-transparent text-sm"
      >
        <option value={1} className="text-black">1 column</option>
        <option value={2} className="text-black">2 columns</option>
      </select>
      <select
        aria-label="Theme"
        value={theme}
        onChange={(e) => setTheme(e.target.value as ThemeId)}
        className="rounded bg-transparent text-sm"
      >
        <option value="parchment" className="text-black">Parchment</option>
        <option value="modern" className="text-black">Modern</option>
        <option value="dark-fantasy" className="text-black">Dark fantasy</option>
      </select>
      <span className="ml-auto flex gap-1">
        {commands.map((c) => (
          <button key={c.id} className={btn} onClick={c.run}>
            {c.label}
          </button>
        ))}
      </span>
    </header>
  )
}
