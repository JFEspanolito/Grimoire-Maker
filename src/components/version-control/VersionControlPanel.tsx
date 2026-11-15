import { friendlyErrorMessage, reportError } from '../../lib/errorLogging'
import { useEffect, useRef, useState } from 'react'
import { commitChanges, diffChange, getRepositoryStatus, initializeRepository, revertChange, rollbackToCommit, stageChange, unstageChange } from '../../lib/versionControl'
import type { GitDiff, GitEntry, RepositoryStatus } from '../../lib/versionControl'
import styles from './VersionControlPanel.module.css'
import { notifyRepositoryChanged, REPOSITORY_CHANGED } from '../../lib/repositoryEvents'
import { GitDiffDialog } from './GitDiffDialog'
import { GitRollbackDialog } from './GitRollbackDialog'
import { ConfirmDialog } from '../layout/ConfirmDialog'
import { ContextMenu } from '../layout/ContextMenu'
import { useDocumentStore } from '../../stores/documentStore'
import { getTranslation, useTranslation } from '../../lib/i18n'
import { useSettingsStore } from '../../stores/settingsStore'
import { restoreGitDocuments } from '../../lib/gitDocumentRestore'

interface VersionControlPanelProps {
  workspace: string | null
  hasUnsavedChanges?: boolean
}

interface Selection {
  path: string
  staged: boolean
}

interface ContextMenuState {
  entry: GitEntry
  staged: boolean
  x: number
  y: number
}



const errorText = (error: unknown) => friendlyErrorMessage(error, getTranslation('ui.could_not_complete_the_git_operation', useSettingsStore.getState().language))

/** Manual local source-control actions; automatic commits are configured separately. */
export function VersionControlPanel(props: VersionControlPanelProps) {
  return <ProjectVersionControlPanel key={props.workspace ?? ''} {...props} />
}

function ProjectVersionControlPanel({ workspace, hasUnsavedChanges = false }: VersionControlPanelProps) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<RepositoryStatus | null>(null)
  const [busy, setBusy] = useState(Boolean(workspace))
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [notice, setNotice] = useState('')
  const [selection, setSelection] = useState<Selection | null>(null)
  const [diff, setDiff] = useState<GitDiff | null>(null)
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const [pendingRevert, setPendingRevert] = useState<GitEntry | null>(null)
  const [rollbackOpen, setRollbackOpen] = useState(false)
  const activeDocPath = useDocumentStore((s) => s.document.path)
  const activeRelativePath = workspace && activeDocPath?.startsWith(`${workspace}/`)
    ? activeDocPath.slice(workspace.length + 1)
    : null
  const epoch = useRef(0)
  const pending = useRef(false)
  const refreshQueued = useRef(false)
  const flushRefresh = useRef(() => {})

  useEffect(() => {
    const current = ++epoch.current
    if (!workspace) return
    const refresh = () => {
      if (current !== epoch.current) return
      if (pending.current) { refreshQueued.current = true; return }
      refreshQueued.current = false
      pending.current = true
      setBusy(true)
      getRepositoryStatus(workspace).then((value) => {
        if (current === epoch.current) { setStatus(value); setSelection(null); setDiff(null) }
      }).catch((reason: unknown) => {
        if (current === epoch.current) { reportError('git.operation', reason); setError(errorText(reason)) }
      }).finally(() => {
        if (current === epoch.current) {
          pending.current = false; setBusy(false)
          flushRefresh.current()
        }
      })
    }
    flushRefresh.current = () => { if (refreshQueued.current) refresh() }
    refresh()
    window.addEventListener(REPOSITORY_CHANGED, refresh)
    return () => {
      epoch.current = current + 1
      pending.current = false
      refreshQueued.current = false
      window.removeEventListener(REPOSITORY_CHANGED, refresh)
      flushRefresh.current = () => {}
    }
  }, [workspace])

  async function run(operation: (project: string) => Promise<void>, successMessage = '') {
    if (!workspace || pending.current) return
    const current = epoch.current
    pending.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await operation(workspace)
      const next = await getRepositoryStatus(workspace)
      if (current !== epoch.current) return
      setStatus(next)
      setSelection(null)
      setDiff(null)
      setNotice(successMessage)
      if (successMessage) setMessage('')
    } catch (reason) {
      if (current === epoch.current) { reportError('git.operation', reason); setError(errorText(reason)) }
    } finally {
      notifyRepositoryChanged()
      if (current === epoch.current) { pending.current = false; setBusy(false); flushRefresh.current() }
    }
  }

  async function showDiff(path: string, staged: boolean) {
    if (!workspace || pending.current) return
    const current = epoch.current
    pending.current = true
    setBusy(true)
    setError('')
    setSelection({ path, staged })
    setDiff(null)
    try {
      const next = await diffChange(workspace, path, staged)
      if (current === epoch.current) setDiff(next)
    } catch (reason) {
      if (current === epoch.current) { reportError('git.operation', reason); setError(errorText(reason)) }
    } finally {
      if (current === epoch.current) { pending.current = false; setBusy(false); flushRefresh.current() }
    }
  }

  const staged = status?.entries.filter((entry) => ![' ', '?', '!'].includes(entry.indexStatus)) ?? []
  const unstaged = status?.entries.filter((entry) => entry.worktreeStatus !== ' ' && entry.indexStatus !== '?') ?? []
  const untracked = status?.entries.filter((entry) => entry.indexStatus === '?') ?? []

  function group(title: string, entries: GitEntry[], isStaged: boolean) {
    if (!entries.length) return null
    return <section className={styles.group} aria-label={title}>
      <h4>{title} <span>{entries.length}</span></h4>
      <ul>
        {entries.map((entry) => <li key={entry.path} onContextMenu={(event) => {
          event.preventDefault()
          event.stopPropagation()
          if (!busy) setMenu({ entry, staged: isStaged, x: event.clientX, y: event.clientY })
        }}>
          <button className={styles.file} disabled={busy} onClick={() => void showDiff(entry.path, isStaged)}
            title={entry.originalPath ? `${entry.originalPath} → ${entry.path}` : entry.path}
            aria-label={t('ui.viewDiff', { state: t(isStaged ? 'ui.staged' : 'ui.unstaged'), path: entry.path })}>
            <span className={styles.code}>{isStaged ? entry.indexStatus : entry.worktreeStatus}</span>
            <span>{entry.path}</span>
          </button>
          <button className={styles.action} disabled={busy} title={t('ui.revert_changes_in_this_file')}
            aria-label={t('ui.revertFile', { path: entry.path })} onClick={() => setPendingRevert(entry)}>
            ↺
          </button>
          <button className={styles.action} disabled={busy} aria-label={t(isStaged ? 'ui.unstageFile' : 'ui.stageFile', { path: entry.path })}
            onClick={() => void run((project) => isStaged ? unstageChange(project, entry.path) : stageChange(project, entry.path))}>
            {isStaged ? '−' : '+'}
          </button>
        </li>)}
      </ul>
    </section>
  }

  return <section className={styles.panel} aria-label={t('ui.source_control')} aria-busy={busy}>
    <div className={styles.header}>
      <h3>{t('ui.source_control')}</h3>
      <button disabled={!workspace || busy} onClick={() => void run(async () => {})} aria-label={t('ui.refresh_source_control')}>{t('ui.refresh')}</button>
    </div>
    {!workspace && <p className={styles.hint}>{t('ui.open_a_project_to_use_git')}</p>}
    {error && <p className={styles.error} role="alert">{error.startsWith('Source Control requires Git.')
      ? <>{t('ui.source_control_requires_git_please_download_it_from')} <a href="https://git-scm.com/install/" target="_blank" rel="noopener noreferrer">{t('ui.the_official_git_website')}</a>.</>
      : error}</p>}
    {busy && <p className={styles.hint} role="status">{t('ui.working')}</p>}
    {notice && <p className={styles.hint} role="status">{notice}</p>}
    {workspace && status && !status.isRepository && <div className={styles.empty}>
      <p>{t('ui.this_project_has_no_git_repository_yet')}</p>
      <button className={styles.initButton} disabled={busy} onClick={() => void run(initializeRepository)}>{t('ui.initialize_git_repository')}</button>
      <p className={styles.hint}>
        {t('ui.version_control_keeps_a_local_timeline_of_your_manuscript_so_you_can_save_checkp')}
      </p>
    </div>}
    {status?.isRepository && <>
      <p className={styles.branch} title={status.branch}>{t('ui.branch', { branch: status.branch })}</p>
      {hasUnsavedChanges && <p className={styles.warning}>{t('ui.unsaved_editor_changes_are_not_included_save_before_staging')}</p>}
      <div className={styles.files}>
        {group(t('ui.staged_changes'), staged, true)}
        {group(t('ui.changes'), unstaged, false)}
        {group(t('ui.untracked_files'), untracked, false)}
        {!status.entries.length && <p className={styles.hint}>{t('ui.working_tree_clean')}</p>}
      </div>
      <form className={styles.commit} onSubmit={(event) => {
        event.preventDefault()
        const commitMessage = message.trim() || 'Saved version'
        void run((project) => commitChanges(project, commitMessage, status.indexFingerprint), t('ui.staged_changes_committed'))
      }}>
        <label htmlFor="git-commit-message">{t('ui.commit_message')}</label>
        <textarea id="git-commit-message" value={message} maxLength={4096} disabled={busy}
          onChange={(event) => setMessage(event.target.value)} rows={2} placeholder={t('ui.describe_the_changes_optional')} />
        <button type="submit" disabled={busy}>{t('ui.save_version')}</button>
        <p className={styles.hint}>{t('ui.saves_staged_files_or_all_changed_files_automatically_if_none_are_staged')}</p>
      </form>
      {(status.commits?.length ?? 0) > 0 && (
        <button type="button" className={styles.rollbackTrigger} disabled={busy}
          aria-label={t('ui.restore_previous_version_rollback')}
          onClick={() => setRollbackOpen(true)}>
          <span>↺ {t('git.rollback.title')}</span>
          <span>{status.commits!.length}</span>
        </button>
      )}
      {rollbackOpen && workspace && (status.commits?.length ?? 0) > 0 && (
        <GitRollbackDialog
          workspace={workspace}
          commits={status.commits!}
          activeRelativePath={activeRelativePath}
          busy={busy}
          onClose={() => setRollbackOpen(false)}
          onRollback={(commit, targetPaths) => {
            setRollbackOpen(false)
            void run(
              (project) => restoreGitDocuments(project, targetPaths, async () => {
                if (targetPaths && targetPaths.length > 0) {
                  for (const targetPath of targetPaths) {
                    await rollbackToCommit(project, commit.hash, targetPath)
                  }
                } else {
                  await rollbackToCommit(project, commit.hash)
                }
              }),
              targetPaths && targetPaths.length > 0
                ? targetPaths.length === 1
                  ? t('ui.restoreFile', { path: targetPaths[0], commit: commit.shortHash })
                  : t('ui.restoreFiles', { count: targetPaths.length, commit: commit.shortHash })
                : t('ui.rollbackProject', { commit: commit.shortHash }),
            )
          }}
        />
      )}
      {selection && <GitDiffDialog path={selection.path} staged={selection.staged} diff={diff} loading={busy}
        error={error} onClose={() => setSelection(null)} />}
      {menu && <ContextMenu label={t('ui.actions', { name: menu.entry.path })} className={styles.contextMenu}
        x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
        <button type="button" role="menuitem" disabled={busy}
          onClick={() => { const { entry, staged: isStaged } = menu; setMenu(null); void showDiff(entry.path, isStaged) }}>
          {t('ui.view_diff')}
        </button>
        <button type="button" role="menuitem" disabled={busy || menu.staged}
          onClick={() => { const { entry } = menu; setMenu(null); void run((project) => stageChange(project, entry.path)) }}>
          {t('ui.add')}
        </button>
        <button type="button" role="menuitem" disabled={busy || !menu.staged}
          onClick={() => { const { entry } = menu; setMenu(null); void run((project) => unstageChange(project, entry.path)) }}>
          {t('ui.remove_from_commit')}
        </button>
        <button type="button" role="menuitem" className={styles.dangerItem} disabled={busy}
          onClick={() => { const { entry } = menu; setMenu(null); setPendingRevert(entry) }}>
          {t('ui.revert')}
        </button>
      </ContextMenu>}
      {pendingRevert && <ConfirmDialog title={t('ui.revert_changes')}
        message={pendingRevert.indexStatus === '?' || pendingRevert.indexStatus === 'A'
          ? t('ui.deleteFile', { path: pendingRevert.path })
          : t('ui.discardFile', { path: pendingRevert.path })}
        confirmLabel={t('ui.revert')} danger onCancel={() => setPendingRevert(null)}
        onConfirm={() => {
          const entry = pendingRevert
          setPendingRevert(null)
          void run((project) => restoreGitDocuments(project, [entry.path, ...(entry.originalPath ? [entry.originalPath] : [])], () => revertChange(project, entry.path)), t('ui.revertedFile', { path: entry.path }))
        }} />}
    </>}
  </section>
}
