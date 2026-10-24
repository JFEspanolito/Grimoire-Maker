import { useFileSystem } from '../../hooks/useFileSystem'
import { useTabStore } from '../../stores/tabStore'
import { useDocumentStore } from '../../stores/documentStore'
import { documentLabel } from '../../lib/documentLabel'

export function DocumentTabs() {
  const paths = useTabStore((state) => state.paths)
  const active = useTabStore((state) => state.active)
  const buffers = useDocumentStore((state) => state.buffers)
  const { openFile, closeTab } = useFileSystem()

  if (paths.length === 0) return null
  return (
    <nav aria-label="Open documents" className="flex min-w-0 overflow-x-auto border-b border-white/10 bg-neutral-900">
      {paths.map((path) => (
        <div key={path} className={`flex shrink-0 items-center border-r border-white/10 ${active === path ? 'bg-neutral-800' : ''}`}>
          <button type="button" className="max-w-48 truncate px-3 py-1.5 text-left text-xs" title={documentLabel(path)}
            aria-current={active === path ? 'page' : undefined}
            onClick={() => void openFile(path).catch(() => undefined)}>
            {documentLabel(path.slice(path.lastIndexOf('/') + 1))}
            {buffers[path]?.dirty && <span aria-label="Unsaved changes"> •</span>}
          </button>
          <button type="button" aria-label={`Close ${documentLabel(path.slice(path.lastIndexOf('/') + 1))}`}
            className="px-2 text-xs text-white/50 hover:text-white"
            onClick={() => void closeTab(path).catch(() => undefined)}>×</button>
        </div>
      ))}
    </nav>
  )
}
