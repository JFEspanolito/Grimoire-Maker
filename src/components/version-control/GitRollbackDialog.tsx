import { useEffect, useRef, useState } from 'react'
import { diffCommit } from '../../lib/versionControl'
import type { GitCommit, GitDiff } from '../../lib/versionControl'
import { friendlyErrorMessage } from '../../lib/errorLogging'
import { splitDiff } from './splitDiff'
import styles from './GitDiffDialog.module.css'

interface Props {
  workspace: string
  commits: GitCommit[]
  activeRelativePath: string | null
  busy: boolean
  onClose: () => void
  onRollback: (commit: GitCommit, path?: string) => void
}

export function GitRollbackDialog({
  workspace,
  commits,
  activeRelativePath,
  busy,
  onClose,
  onRollback,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [selectedHash, setSelectedHash] = useState<string>(commits[0]?.hash ?? '')
  const [diff, setDiff] = useState<GitDiff | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const selectedCommit = commits.find((c) => c.hash === selectedHash) ?? commits[0] ?? null

  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])

  useEffect(() => {
    if (!selectedCommit) return
    let active = true
    setLoading(true)
    setError('')
    setDiff(null)
    diffCommit(workspace, selectedCommit.hash)
      .then((result) => {
        if (active) setDiff(result)
      })
      .catch((err: unknown) => {
        if (active) setError(friendlyErrorMessage(err, 'Could not load checkpoint diff.'))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [workspace, selectedCommit?.hash])

  const rows = splitDiff(diff?.text ?? '')

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby="git-rollback-title"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <header className={styles.header}>
        <div>
          <h2 id="git-rollback-title">Recent checkpoints (Rollback)</h2>
          <p>
            Select a checkpoint to preview differences between your current files and that version before restoring.
          </p>
        </div>
        <button type="button" aria-label="Close rollback dialog" onClick={onClose}>
          Close
        </button>
      </header>

      <div className={styles.rollbackBody}>
        <ul className={styles.checkpointList} aria-label="Checkpoints">
          {commits.map((commit) => {
            const isSelected = commit.hash === selectedCommit?.hash
            return (
              <li key={commit.hash}>
                <button
                  type="button"
                  aria-label={`Rollback to ${commit.shortHash}`}
                  aria-pressed={isSelected}
                  className={`${styles.checkpointItem} ${isSelected ? styles.checkpointItemActive : ''}`}
                  onClick={() => setSelectedHash(commit.hash)}
                >
                  <span className={styles.checkpointTitle}>{commit.subject}</span>
                  <span className={styles.checkpointMeta}>
                    {commit.timestamp} · {commit.shortHash}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>

        <div className={styles.diffPane}>
          <p className={styles.legend}>
            <span className={styles.removed}>− Current (will be replaced)</span>
            <span className={styles.added}>+ Checkpoint (will be restored)</span>
            {selectedCommit && (
              <span>
                Comparing working tree → <strong>{selectedCommit.shortHash}</strong> ({selectedCommit.subject})
              </span>
            )}
          </p>
          {loading && <p role="status">Loading checkpoint diff…</p>}
          {error && <p role="alert">{error}</p>}
          {diff?.binary ? (
            <p>Binary file changes: text diff unavailable.</p>
          ) : (
            <div className={styles.scroll} tabIndex={0} aria-label="Checkpoint diff preview">
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Current working tree</th>
                    <th scope="col">Checkpoint ({selectedCommit?.shortHash ?? ''})</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={index}>
                      {row.note !== undefined ? (
                        <td colSpan={2} className={styles.note}>
                          {row.note}
                        </td>
                      ) : (
                        (['original', 'incoming'] as const).map((side) => {
                          const line = row[side]
                          const change = line?.changed
                            ? side === 'original'
                              ? 'removed'
                              : 'added'
                            : undefined
                          return (
                            <td key={side} data-change={change} className={change ? styles[change] : undefined}>
                              <div className={styles.line}>
                                <span className={styles.number}>{line?.number}</span>
                                <span className={styles.sign} aria-hidden="true">
                                  {change === 'removed' ? '−' : change === 'added' ? '+' : ''}
                                </span>
                                <code>{line?.text ?? ''}</code>
                              </div>
                            </td>
                          )
                        })
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {!loading && !error && !rows.length && (
                <p style={{ padding: '.75rem' }}>No differences between current files and this checkpoint.</p>
              )}
            </div>
          )}
          {diff?.truncated && <p className={styles.warning}>Preview truncated. The full diff is not shown.</p>}
        </div>
      </div>

      <footer className={styles.footer}>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        {selectedCommit && activeRelativePath && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onRollback(selectedCommit, activeRelativePath)}
          >
            {`Restore "${activeRelativePath}" only`}
          </button>
        )}
        {selectedCommit && (
          <button
            type="button"
            className={styles.dangerBtn}
            disabled={busy}
            onClick={() => onRollback(selectedCommit)}
          >
            Restore entire project
          </button>
        )}
      </footer>
    </dialog>
  )
}
