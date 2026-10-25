import { useEffect, useMemo, useRef } from 'react'
import { useDocumentStore } from '../../stores/documentStore'
import { computeStatistics, formatDuration } from '../../lib/statistics'
import styles from './StatisticsDialog.module.css'

type Row = readonly [label: string, value: string | number]

export function StatisticsDialog({ onClose }: { onClose: () => void }) {
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
    [['Words', stats.words], ['Characters', stats.characters], ['Characters (No Spaces)', stats.charactersNoSpaces]],
    [['Paragraphs', stats.paragraphs], ['Sentences', stats.sentences],
      ['Average Paragraph Length', stats.averageParagraphLength], ['Average Sentence Length', stats.averageSentenceLength]],
    [['Documents', stats.documents], ['Average document length', `${stats.averageDocumentLength} words`],
      ['Longest document', `${stats.longestDocument} words`], ['Shortest document', `${stats.shortestDocument} words`]],
    [['Pages (paperback)', stats.pages], ['Reading Time', formatDuration(stats.readingSeconds)]],
  ]

  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="statistics-title"
    onCancel={(event) => { event.preventDefault(); onClose() }}>
    <header className={styles.header}>
      <h2 id="statistics-title">Statistics</h2>
      <button type="button" className={styles.dismiss} aria-label="Close Statistics" onClick={onClose}>×</button>
    </header>
    <div className={styles.groups}>
      {groups.map((rows) => <dl key={rows[0][0]}>
        {rows.map(([label, value]) => <div key={label}><dt>{label}:</dt><dd>{value}</dd></div>)}
      </dl>)}
    </div>
    <details className={styles.frequency}>
      <summary>Word Frequency</summary>
      <table>
        <thead><tr><th scope="col">Word</th><th scope="col">Count</th><th scope="col">Frequency</th></tr></thead>
        <tbody>
          {stats.frequency.length ? stats.frequency.map(({ word, count, share }) => <tr key={word}>
            <td>{word}</td><td>{count}</td>
            <td><span className={styles.bar} style={{ width: `${Math.round(share * 100)}%` }}>{Math.round(share * 100)}%</span></td>
          </tr>) : <tr><td colSpan={3}>No words yet</td></tr>}
        </tbody>
      </table>
    </details>
    <footer className={styles.footer}><button type="button" onClick={onClose}>Close</button></footer>
  </dialog>
}
