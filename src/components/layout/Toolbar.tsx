import { useDocumentStore } from '../../stores/documentStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { usePluginRegistry } from '../../plugins/plugin-manager'
import { useFileSystem } from '../../hooks/useFileSystem'
import { usePrint } from '../../hooks/usePrint'
import { useThemeStore } from '../../stores/themeStore'
import { resolveTheme } from '../../lib/themes'
import { PAGE_SIZES, type PageSizeId, type ViewMode } from '../../types/document'
import { ProjectName } from './ProjectName'
import { useTabStore } from '../../stores/tabStore'
import styles from './Toolbar.module.css'

const btn = styles.button

const VIEWS: [ViewMode, string][] = [
  ['edit', 'Edit'],
  ['pages', 'Pages'],
  ['spreads', 'Spreads'],
]

type Panel = 'files' | 'templates' | 'snippets'

export function Toolbar({ visiblePanels, onTogglePanel }: {
  visiblePanels: Record<Panel, boolean>
  onTogglePanel: (panel: Panel) => void
}) {
  const { openFile, saveFile } = useFileSystem()
  const exportPdf = usePrint()
  const { pageSize, columns, theme, viewMode, setPageSize, setColumns, setTheme, setViewMode } =
    useSettingsStore()
  const { themes, dir: themesDir, errors: themeErrors } = useThemeStore()
  const dirty = useDocumentStore((s) => s.document.dirty)
  const commands = usePluginRegistry((s) => s.commands)
  const split = useTabStore((s) => s.split)

  return (
    <header className={styles.toolbar}>
      <div className={styles.group} role="group" aria-label="Document actions">
      <ProjectName />
      {dirty && <span className="text-amber-400" title="Unsaved document changes">•</span>}
      <button className={btn} onClick={() => void openFile().catch(() => undefined)}>
        Open
      </button>
      <button className={btn} onClick={() => void saveFile().catch(() => undefined)}>
        Save
      </button>
      <button className={btn} onClick={exportPdf}>
        Export PDF
      </button>
      </div>
      <div className={styles.group} role="group" aria-label="Panels">
        {(['files', 'templates', 'snippets'] as const).map((panel) => (
          <button
            key={panel}
            type="button"
            className={`${btn} ${visiblePanels[panel] ? 'bg-white/10' : ''}`}
            aria-label={`${visiblePanels[panel] ? 'Hide' : 'Show'} ${panel} panel`}
            aria-pressed={visiblePanels[panel]}
            onClick={() => onTogglePanel(panel)}
          >
            {panel[0].toUpperCase() + panel.slice(1)}
          </button>
        ))}
      </div>
      <div className={styles.group} role="group" aria-label="Page setup">
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
      </div>
      <div className={styles.group} role="group" aria-label="Appearance and preview">
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
      </div>
      <span className={styles.tools} role="group" aria-label="Editor tools">
        {commands.map((c) => (
          <button key={c.id} className={btn} onClick={c.run}>
            {c.label}
          </button>
        ))}
        <button type="button" className={btn} aria-pressed={split} onClick={() => useTabStore.getState().toggleSplit()}>Split View</button>
      </span>
    </header>
  )
}
