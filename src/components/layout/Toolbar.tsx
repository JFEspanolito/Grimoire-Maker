import { useDocumentStore } from '../../stores/documentStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { usePluginRegistry } from '../../plugins/plugin-manager'
import { useFileSystem } from '../../hooks/useFileSystem'
import { usePrint } from '../../hooks/usePrint'
import { useThemeStore } from '../../stores/themeStore'
import { resolveTheme } from '../../lib/themes'
import { PAGE_SIZES, type PageSizeId, type ViewMode } from '../../types/document'

const btn = 'rounded px-2 py-1 text-sm hover:bg-white/10'

const VIEWS: [ViewMode, string][] = [
  ['edit', 'Edit'],
  ['pages', 'Pages'],
  ['spreads', 'Spreads'],
]

export function Toolbar() {
  const { openFile, saveFile } = useFileSystem()
  const exportPdf = usePrint()
  const { pageSize, columns, theme, viewMode, setPageSize, setColumns, setTheme, setViewMode } =
    useSettingsStore()
  const { themes, dir: themesDir, errors: themeErrors } = useThemeStore()
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
        aria-label="View"
        title="Edit the sheet, or preview the paginated pages and facing spreads"
        value={viewMode}
        onChange={(e) => setViewMode(e.target.value as ViewMode)}
        className="rounded bg-transparent text-sm"
      >
        {VIEWS.map(([value, label]) => (
          <option key={value} value={value} className="text-black">
            {label}
          </option>
        ))}
      </select>
      <select
        aria-label="Theme"
        title={[themesDir && `Custom themes folder: ${themesDir}`, ...themeErrors].filter(Boolean).join('\n')}
        value={resolveTheme(theme, themes)}
        onChange={(e) => setTheme(e.target.value)}
        className="rounded bg-transparent text-sm"
      >
        {themes.map((t) => (
          <option key={t.id} value={t.id} className="text-black">
            {t.name}
          </option>
        ))}
      </select>
      {themeErrors.length > 0 && (
        <span className="text-xs text-amber-400" title={themeErrors.join('\n')}>
          {themeErrors.length} theme error{themeErrors.length > 1 ? 's' : ''}
        </span>
      )}
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
