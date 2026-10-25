import { useEffect, useRef } from 'react'
import type { GitDiff } from '../../lib/versionControl'
import { splitDiff } from './splitDiff'
import styles from './GitDiffDialog.module.css'

interface Props { path: string; staged: boolean; diff: GitDiff | null; loading: boolean; error: string; onClose: () => void }

export function GitDiffDialog({ path, staged, diff, loading, error, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])
  const rows = splitDiff(diff?.text ?? '')
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="git-diff-title"
    onCancel={event => { event.preventDefault(); onClose() }}>
    <header className={styles.header}>
      <div><h2 id="git-diff-title">{path}</h2><p>{staged ? 'HEAD → Staged changes' : 'Index → Working tree'} · Read-only comparison</p></div>
      <button type="button" aria-label="Close diff" onClick={onClose}>Close</button>
    </header>
    <p className={styles.legend}><span className={styles.removed}>− Deleted</span><span className={styles.added}>+ Added</span> Changes and surrounding context</p>
    {loading && <p role="status">Loading diff…</p>}
    {error && <p role="alert">{error}</p>}
    {diff?.binary ? <p>Binary file: text diff unavailable.</p> : <div className={styles.scroll} tabIndex={0} aria-label="Side-by-side file diff">
      <table className={styles.table}>
        <thead><tr><th scope="col">Original</th><th scope="col">Incoming change</th></tr></thead>
        <tbody>{rows.map((row, index) => <tr key={index}>
          {row.note !== undefined ? <td colSpan={2} className={styles.note}>{row.note}</td>
            : (['original', 'incoming'] as const).map(side => {
              const line = row[side]
              const change = line?.changed ? side === 'original' ? 'removed' : 'added' : undefined
              return <td key={side} data-change={change} className={change ? styles[change] : undefined}>
                <div className={styles.line}><span className={styles.number}>{line?.number}</span>
                  <span className={styles.sign} aria-hidden="true">{change === 'removed' ? '−' : change === 'added' ? '+' : ''}</span>
                  <code>{line?.text ?? ''}</code>
                </div>
              </td>
            })}
        </tr>)}</tbody>
      </table>
      {!loading && !error && !rows.length && <p>No text changes.</p>}
    </div>}
    {diff?.truncated && <p className={styles.warning}>Preview truncated. The full file is not shown.</p>}
  </dialog>
}
