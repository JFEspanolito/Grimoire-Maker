import { useMemo, useState } from 'react'
import { useDocumentStore } from '../../stores/documentStore'
import { useLayoutStore } from '../../stores/layoutStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { computeStatistics } from '../../lib/statistics'
import { StatisticsDialog } from './StatisticsDialog'
import styles from './StatusBar.module.css'
import { useTranslation } from '../../lib/i18n'

/** Document figures on the left (they open Statistics) and the page view switch on the right. */
export function StatusBar() {
  const { t } = useTranslation()
  const [statistics, setStatistics] = useState(false)
  const body = useDocumentStore((state) => state.document.body)
  const key = useDocumentStore((state) => state.document.path ?? '__untitled__')
  const pages = useLayoutStore((state) => state.sheets[key] ?? 1)
  const { viewMode, setViewMode } = useSettingsStore()
  const words = useMemo(() => computeStatistics([body]).words, [body])
  const spreads = viewMode === 'spreads'

  return <footer className={styles.bar} aria-label={t('status.documentStatus')}>
    <div className={styles.stats}>
      <button type="button" className={styles.stat} onClick={() => setStatistics(true)} title={t('status.openStatistics')}>
        {t('status.pages')}: <span className={styles.value}>{pages}</span>
      </button>
      <button type="button" className={styles.stat} onClick={() => setStatistics(true)} title={t('status.openStatistics')}>
        {t('status.words')}: <span className={styles.value}>{words}</span>
      </button>
    </div>
    <div className={styles.views} role="group" aria-label={t('status.pageLayout')}>
      <button type="button" className={styles.view} aria-pressed={!spreads} aria-label={t('toolbar.singlePage')} title={t('toolbar.singlePage')}
        onClick={() => setViewMode('edit')}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="2" width="8" height="12" rx="1" /></svg>
      </button>
      <button type="button" className={styles.view} aria-pressed={spreads} aria-label={t('toolbar.spread')} title={t('toolbar.spread')}
        onClick={() => setViewMode('spreads')}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="3" width="6" height="10" rx="1" /><rect x="8.5" y="3" width="6" height="10" rx="1" /></svg>
      </button>
    </div>
    {statistics && <StatisticsDialog onClose={() => setStatistics(false)} />}
  </footer>
}
