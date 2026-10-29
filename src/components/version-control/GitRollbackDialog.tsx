import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { diffCommit } from '../../lib/versionControl'
import type { GitCommit, GitDiff } from '../../lib/versionControl'
import { friendlyErrorMessage } from '../../lib/errorLogging'
import { splitDiff } from './splitDiff'
import type { DiffRow } from './splitDiff'
import styles from './GitDiffDialog.module.css'
import { useTranslation } from '../../lib/i18n'

interface Props {
  workspace: string
  commits: GitCommit[]
  activeRelativePath: string | null
  busy: boolean
  onClose: () => void
  onRollback: (commit: GitCommit, paths?: string[]) => void
}

interface FileSection {
  file: string
  rows: DiffRow[]
}

function groupRowsByFile(rows: DiffRow[], fallbackFile: string | null): FileSection[] {
  const sections: FileSection[] = []
  let current: FileSection | null = null

  for (const row of rows) {
    if (row.file !== undefined) {
      current = { file: row.file, rows: [] }
      sections.push(current)
    } else {
      if (!current) {
        current = { file: fallbackFile ?? 'Modified file', rows: [] }
        sections.push(current)
      }
      current.rows.push(row)
    }
  }
  return sections
}

function formatRestoreSelectedLabel(checkedFiles: string[]): string {
  if (checkedFiles.length === 0) {
    return 'Restore "[0 Files]"'
  }
  if (checkedFiles.length === 1) {
    return `Restore "${checkedFiles[0]}" only`
  }
  const topFolders = new Set(
    checkedFiles.map((file) => (file.includes('/') ? file.split('/')[0] : 'Draft')),
  )
  const prefix = topFolders.size === 1 ? [...topFolders][0] : 'Draft'
  return `Restore "${prefix}/**/[${checkedFiles.length} Files]"`
}

export function GitRollbackDialog({
  workspace,
  commits,
  activeRelativePath,
  busy,
  onClose,
  onRollback,
}: Props) {
  const { t } = useTranslation()
  const dialog = useRef<HTMLDialogElement>(null)
  const [selectedHash, setSelectedHash] = useState<string>(commits[0]?.hash ?? '')
  const [diff, setDiff] = useState<GitDiff | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [checkedFiles, setCheckedFiles] = useState<Set<string>>(new Set())
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set())

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

  const sections = useMemo(
    () => groupRowsByFile(splitDiff(diff?.text ?? ''), activeRelativePath),
    [diff?.text, activeRelativePath],
  )

  useEffect(() => {
    // Auto-check all files in the version by default, and start all file sections collapsed (Expanded = false)
    setCheckedFiles(new Set(sections.map((section) => section.file)))
    setExpandedFiles(new Set())
  }, [sections])

  const toggleChecked = (file: string) => {
    setCheckedFiles((prev) => {
      const next = new Set(prev)
      if (next.has(file)) next.delete(file)
      else next.add(file)
      return next
    })
  }

  const toggleExpanded = (file: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev)
      if (next.has(file)) next.delete(file)
      else next.add(file)
      return next
    })
  }

  const orderedChecked = sections
    .map((section) => section.file)
    .filter((file) => checkedFiles.has(file))

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
          <h2 id="git-rollback-title">{t('git.rollback.title')}</h2>
          <p>{t('git.rollback.desc')}</p>
        </div>
        <button type="button" aria-label={t('git.rollback.close')} onClick={onClose}>
          {t('common.close')}
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
            <span className={styles.removed}>{t('git.diff.removed')}</span>
            <span className={styles.added}>{t('git.diff.added')}</span>
          </p>
          <div className={styles.scroll} tabIndex={0} aria-label="Version diff preview">
            {loading && <p role="status" style={{ padding: '.75rem', margin: 0 }}>{t('git.rollback.loading')}</p>}
            {error && <p role="alert" style={{ padding: '.75rem', margin: 0 }}>{error}</p>}
            {diff?.binary ? (
              <p style={{ padding: '.75rem', margin: 0 }}>Binary file changes: text preview unavailable.</p>
            ) : (
              !loading && !error && (
                <>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th scope="col">{t('git.rollback.changeList')}</th>
                        <th scope="col">
                          {selectedCommit
                            ? `Saved version at ${selectedCommit.timestamp} (${selectedCommit.shortHash})`
                            : 'Saved version'}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sections.map((section) => {
                        const isChecked = checkedFiles.has(section.file)
                        const isExpanded = expandedFiles.has(section.file)
                        return (
                          <Fragment key={section.file}>
                            <tr className={styles.fileRow}>
                              <td>
                                <div className={styles.fileRowHeader}>
                                  <input
                                    type="checkbox"
                                    className={styles.fileCheckbox}
                                    checked={isChecked}
                                    aria-label={`Include ${section.file} in rollback`}
                                    onChange={() => toggleChecked(section.file)}
                                  />
                                  <button
                                    type="button"
                                    className={styles.fileCollapseBtn}
                                    aria-expanded={isExpanded}
                                    aria-label={`Toggle diff for ${section.file}`}
                                    onClick={() => toggleExpanded(section.file)}
                                  >
                                    <span className={styles.chevron} aria-hidden="true">
                                      {isExpanded ? '▾' : '▸'}
                                    </span>
                                    <span>{`${section.file} ${t('git.rollback.previousVersion')}`}</span>
                                  </button>
                                </div>
                              </td>
                              <td
                                className={styles.fileRowMeta}
                                onClick={() => toggleExpanded(section.file)}
                              >
                                {t('git.rollback.currentFile')}
                              </td>
                            </tr>
                            {isExpanded &&
                              section.rows.map((row, index) => (
                                <tr key={`${section.file}-${index}`}>
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
                                      const kindClass = styles[`kind_${line?.kind ?? 'body'}`] ?? ''
                                      return (
                                        <td
                                          key={side}
                                          data-change={change}
                                          className={change ? styles[change] : undefined}
                                        >
                                          <div className={styles.line}>
                                            <span className={styles.number}>{line?.number}</span>
                                            <span className={styles.sign} aria-hidden="true">
                                              {change === 'removed' ? '−' : change === 'added' ? '+' : ''}
                                            </span>
                                            <span className={`${styles.viewerText} ${kindClass}`}>
                                              {line?.text ?? ''}
                                            </span>
                                          </div>
                                        </td>
                                      )
                                    })
                                  )}
                                </tr>
                              ))}
                          </Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                  {!sections.length && (
                    <p style={{ padding: '.75rem', margin: 0 }}>{t('git.rollback.noDiff')}</p>
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
          {t('common.cancel')}
        </button>
        {selectedCommit && sections.length > 0 && (
          <button
            type="button"
            className={styles.primaryBtn}
            disabled={busy || orderedChecked.length === 0}
            onClick={() => onRollback(selectedCommit, orderedChecked)}
          >
            {formatRestoreSelectedLabel(orderedChecked)}
          </button>
        )}
        {selectedCommit && (
          <button
            type="button"
            className={styles.dangerBtn}
            disabled={busy}
            onClick={() => onRollback(selectedCommit)}
          >
            {t('git.rollback.restoreEntire')}
          </button>
        )}
      </footer>
    </dialog>
  )
}
