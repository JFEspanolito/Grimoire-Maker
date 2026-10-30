import { useFileSystem } from '../../hooks/useFileSystem'
import { useTabStore } from '../../stores/tabStore'
import { useDocumentStore } from '../../stores/documentStore'
import { documentLabel } from '../../lib/documentLabel'
import { useTranslation } from '../../lib/i18n'
import { useAppUpdateStore } from '../../stores/appUpdateStore'
import { openExternalUrl } from '../../lib/openUrl'

interface DocumentTabsProps {
  markdownViews: Record<string, boolean>
  onChangeView: (path: string) => void
}

export function DocumentTabs({ markdownViews, onChangeView }: DocumentTabsProps) {
  const { t } = useTranslation()
  const paths = useTabStore((state) => state.paths)
  const active = useTabStore((state) => state.active)
  const buffers = useDocumentStore((state) => state.buffers)
  const updateInfo = useAppUpdateStore((state) => state.info)
  const { openFile, closeTab } = useFileSystem()

  const hasUpdate = !!updateInfo?.hasUpdate
  if (paths.length === 0 && !hasUpdate) return null

  return (
    <nav aria-label="Open documents" className="flex min-w-0 items-center border-b border-white/10 bg-neutral-900">
      <div className="flex min-w-0 flex-1 overflow-x-auto">
        {paths.map((path) => (
          <div key={path} className={`flex shrink-0 items-center border-r border-white/10 ${active === path ? 'bg-neutral-800' : ''}`}>
            {/\.md$/i.test(path) && <button type="button"
              aria-label={`Change view for ${documentLabel(path.slice(path.lastIndexOf('/') + 1))}`}
              aria-pressed={!!markdownViews[path]}
              title={markdownViews[path] ? 'View in page mode' : 'View in Markdown mode'}
              className="ml-1 rounded px-2 py-1 text-xs text-white/60 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-amber-200"
              onClick={() => onChangeView(path)}>{markdownViews[path] ? 'Page' : 'MD'}</button>}
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
      </div>
      {hasUpdate && (
        <a
          href="https://github.com/JFEspanolito/Grimoire-Maker/releases/latest"
          target="_blank"
          rel="noopener noreferrer"
          onClick={(event) => {
            event.preventDefault()
            void openExternalUrl('https://github.com/JFEspanolito/Grimoire-Maker/releases/latest')
          }}
          className="ml-auto mr-3 flex shrink-0 items-center gap-1.5 px-2 py-1 text-xs text-red-400/80 transition-colors hover:text-red-300 hover:underline"
          title={`${t('about.newVersionAvailable')}${updateInfo.latestVersion}`}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          <span>{t('about.updateAvailable')}{updateInfo.latestVersion}</span>
        </a>
      )}
    </nav>
  )
}
