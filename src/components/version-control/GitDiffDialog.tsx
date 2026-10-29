import { useEffect, useRef } from 'react'
import type { GitDiff } from '../../lib/versionControl'
import { splitDiff } from './splitDiff'
import styles from './GitDiffDialog.module.css'
import { useTranslation } from '../../lib/i18n'

interface Props { path: string; staged: boolean; diff: GitDiff | null; loading: boolean; error: string; onClose: () => void }

export function GitDiffDialog({ path, staged, diff, loading, error, onClose }: Props) {
  const { t } = useTranslation()
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])
  // Single-file diff dialog already displays the file name in the header, so filter out the duplicate file row
  const rows = splitDiff(diff?.text ?? '').filter(row => row.file === undefined)
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="git-diff-title"
    onCancel={event => { event.preventDefault(); onClose() }}>
    <header className={styles.header}>
      <div><h2 id="git-diff-title">{path}</h2><p>{staged ? t('git.diff.stagedDesc') : t('git.diff.workingDesc')} · {t('git.diff.title')}</p></div>
      <button type="button" aria-label={t('git.diff.close')} onClick={onClose}>{t('common.close')}</button>
    </header>
    <p className={styles.legend}><span className={styles.removed}>{t('git.diff.removed')}</span><span className={styles.added}>{t('git.diff.added')}</span></p>
    {loading && <p role="status">{t('git.diff.loading')}</p>}
    {error && <p role="alert">{error}</p>}
    {diff?.binary ? <p>{t('git.diff.binary')}</p> : <div className={styles.scroll} tabIndex={0} aria-label={t('git.diff.sideBySide')}>}
      <table className={styles.table}>
        <thead><tr><th scope="col">{t('git.diff.original')}</th><th scope="col">{t('git.diff.incoming')}</th></tr></thead>
        <tbody>{rows.map((row, index) => <tr key={index}>
          {row.note !== undefined ? <td colSpan={2} className={styles.note}>{row.note}</td>
            : (['original', 'incoming'] as const).map(side => {
              const line = row[side]
              const change = line?.changed ? side === 'original' ? 'removed' : 'added' : undefined
              const kindClass = styles[`kind_${line?.kind ?? 'body'}`] ?? ''
              return <td key={side} data-change={change} className={change ? styles[change] : undefined}>
                <div className={styles.line}><span className={styles.number}>{line?.number}</span>
                  <span className={styles.sign} aria-hidden="true">{change === 'removed' ? '−' : change === 'added' ? '+' : ''}</span>
                  <span className={`${styles.viewerText} ${kindClass}`}>{line?.text ?? ''}</span>
                </div>
              </td>
            })}
        </tr>)}</tbody>
      </table>
      {!loading && !error && !rows.length && <p style={{ padding: '.75rem', margin: 0 }}>{t('git.diff.noChanges')}</p>}
    </div>}
    {diff?.truncated && <p className={styles.warning}>{t('git.diff.truncated')}</p>}
  </dialog>
}
