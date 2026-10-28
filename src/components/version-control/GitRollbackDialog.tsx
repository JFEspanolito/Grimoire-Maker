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
        if (active) setError(friendlyErrorMessage(err, 'Could not load version preview.'))
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
          <h2 id="git-rollback-title">Restore previous version (Rollback)</h2>
          <p>
            Choose a saved version from your history on the left to preview what will change before restoring.
          </p>
        </div>
        <button type="button" aria-label="Close rollback dialog" onClick={onClose}>
          Close
        </button>
      </header>

      <div className={styles.rollbackBody}>
        <ul className={styles.checkpointList} aria-label="Saved versions">
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
            <span className={styles.removed}>− Current version (will be replaced)</span>
            <span className={styles.added}>+ Saved version (will be restored)</span>
            {selectedCommit && (
              <span>
                Comparing current files → <strong>{selectedCommit.shortHash}</strong> ({selectedCommit.subject})
              </span>
            )}
          </p>
          <div className={styles.scroll} tabIndex={0} aria-label="Version diff preview">
            {loading && <p role="status" style={{ padding: '.75rem', margin: 0 }}>Loading version preview…</p>}
            {error && <p role="alert" style={{ padding: '.75rem', margin: 0 }}>{error}</p>}
            {diff?.binary ? (
              <p style={{ padding: '.75rem', margin: 0 }}>Binary file changes: text preview unavailable.</p>
            ) : (
              !loading && !error && (
                <>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th scope="col">Current files</th>
                        <th scope="col">Saved version ({selectedCommit?.shortHash ?? ''})</th>
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
                  {!rows.length && (
                    <p style={{ padding: '.75rem', margin: 0 }}>No differences between your current files and this saved version.</p>
                  )}
                </>
              )
            )}
          </div>
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
            className={styles.primaryBtn}
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
