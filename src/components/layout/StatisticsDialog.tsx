import { useEffect, useMemo, useRef } from 'react'
import { useDocumentStore } from '../../stores/documentStore'
import { computeStatistics, formatDuration } from '../../lib/statistics'
import { useTranslation } from '../../lib/i18n'
import styles from './StatisticsDialog.module.css'

type Row = readonly [label: string, value: string | number]

export function StatisticsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const dialog = useRef<HTMLDialogElement>(null)
  const current = useDocumentStore((s) => s.document)
  const buffers = useDocumentStore((s) => s.buffers)
  const stats = useMemo(() => {
    const open = { ...buffers, [current.path ?? '__untitled__']: current }
    return computeStatistics(Object.values(open).filter((doc) => !doc.path || /\.md$/i.test(doc.path)).map((doc) => doc.body))
  }, [buffers, current])

  useEffect(() => {
    const element = dialog.current
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    element?.showModal()
    return () => {
      element?.close()
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [])

  const groups: Row[][] = [
    [[t('stats.words'), stats.words], [t('stats.characters'), stats.characters], [t('stats.charactersNoSpaces'), stats.charactersNoSpaces]],
    [[t('stats.paragraphs'), stats.paragraphs], [t('stats.sentences'), stats.sentences],
      [t('stats.averageParagraphLength'), stats.averageParagraphLength], [t('stats.averageSentenceLength'), stats.averageSentenceLength]],
    [[t('stats.documents'), stats.documents], [t('stats.averageDocumentLength'), `${stats.averageDocumentLength} ${t('stats.wordsUnit')}`],
      [t('stats.longestDocument'), `${stats.longestDocument} ${t('stats.wordsUnit')}`], [t('stats.shortestDocument'), `${stats.shortestDocument} ${t('stats.wordsUnit')}`]],
    [[t('stats.pagesPaperback'), stats.pages], [t('stats.readingTime'), formatDuration(stats.readingSeconds)]],
  ]

  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="statistics-title"
    onCancel={(event) => { event.preventDefault(); onClose() }}>
    <header className={styles.header}>
      <h2 id="statistics-title">{t('stats.title')}</h2>
      <button type="button" className={styles.dismiss} aria-label={t('stats.close')} onClick={onClose}>×</button>
    </header>
    <div className={styles.groups}>
      {groups.map((rows) => <dl key={rows[0][0]}>
        {rows.map(([label, value]) => <div key={label}><dt>{label}:</dt><dd>{value}</dd></div>)}
      </dl>)}
    </div>
    <details className={styles.frequency}>
      <summary>{t('stats.wordFrequency')}</summary>
      <table>
        <thead><tr><th scope="col">{t('stats.tableWord')}</th><th scope="col">{t('stats.tableCount')}</th><th scope="col">{t('stats.tableFrequency')}</th></tr></thead>
        <tbody>
          {stats.frequency.length ? stats.frequency.map(({ word, count, share }) => <tr key={word}>
            <td>{word}</td><td>{count}</td>
            <td><span className={styles.bar} style={{ width: `${Math.round(share * 100)}%` }}>{Math.round(share * 100)}%</span></td>
          </tr>) : <tr><td colSpan={3}>{t('stats.noWords')}</td></tr>}
        </tbody>
      </table>
    </details>
    <footer className={styles.footer}><button type="button" onClick={onClose}>{t('common.close')}</button></footer>
  </dialog>
}
