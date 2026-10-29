import { friendlyErrorMessage, reportError } from '../../lib/errorLogging'
import { useEffect, useRef, useState } from 'react'
import { commitChanges, diffChange, getRepositoryStatus, initializeRepository, revertChange, rollbackToCommit, stageChange, unstageChange } from '../../lib/versionControl'
import type { GitDiff, GitEntry, RepositoryStatus } from '../../lib/versionControl'
import styles from './VersionControlPanel.module.css'
import { notifyRepositoryChanged, REPOSITORY_CHANGED } from '../../lib/repositoryEvents'
import { GitDiffDialog } from './GitDiffDialog'
import { GitRollbackDialog } from './GitRollbackDialog'
import { ConfirmDialog } from '../layout/ConfirmDialog'
import { useDocumentStore } from '../../stores/documentStore'

async function reloadActiveDocumentFromDisk(workspace: string) {
  if (!('__TAURI_INTERNALS__' in window)) return
  const activePath = useDocumentStore.getState().document.path
  if (!activePath || !activePath.startsWith(`${workspace}/`) || !/\.md$/i.test(activePath)) return
  try {
    const { exists, readTextFile } = await import('@tauri-apps/plugin-fs')
    if (await exists(activePath)) {
      const raw = await readTextFile(activePath)
      useDocumentStore.getState().loadFromRaw(activePath, raw)
    }
  } catch {
    // Keep the existing buffer if disk reload is unavailable.
  }
}

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

const errorText = (error: unknown) => friendlyErrorMessage(error, 'Could not complete the Git operation.')

/** Manual local source-control actions; automatic commits are configured separately. */
export function VersionControlPanel(props: VersionControlPanelProps) {
  return <ProjectVersionControlPanel key={props.workspace ?? ''} {...props} />
}

function ProjectVersionControlPanel({ workspace, hasUnsavedChanges = false }: VersionControlPanelProps) {
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
    if (!menu) return
    const close = () => setMenu(null)
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenu(null) }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

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
            aria-label={`View ${isStaged ? 'staged' : 'unstaged'} diff for ${entry.path}`}>
            <span className={styles.code}>{isStaged ? entry.indexStatus : entry.worktreeStatus}</span>
            <span>{entry.path}</span>
          </button>
          <button className={styles.action} disabled={busy} title="Revert changes in this file"
            aria-label={`Revert ${entry.path}`} onClick={() => setPendingRevert(entry)}>
            ↺
          </button>
          <button className={styles.action} disabled={busy} aria-label={`${isStaged ? 'Unstage' : 'Stage'} ${entry.path}`}
            onClick={() => void run((project) => isStaged ? unstageChange(project, entry.path) : stageChange(project, entry.path))}>
            {isStaged ? '−' : '+'}
          </button>
        </li>)}
      </ul>
    </section>
  }

  return <section className={styles.panel} aria-label="Source control" aria-busy={busy}>
    <div className={styles.header}>
      <h3>Source control</h3>
      <button disabled={!workspace || busy} onClick={() => void run(async () => {})} aria-label="Refresh source control">Refresh</button>
    </div>
    {!workspace && <p className={styles.hint}>Open a project to use Git.</p>}
    {error && <p className={styles.error} role="alert">{error.startsWith('Source Control requires Git.')
      ? <>Source Control requires Git. Please download it from <a href="https://git-scm.com/install/" target="_blank" rel="noopener noreferrer">the official Git website</a>.</>
      : error}</p>}
    {busy && <p className={styles.hint} role="status">Working…</p>}
    {notice && <p className={styles.hint} role="status">{notice}</p>}
    {workspace && status && !status.isRepository && <div className={styles.empty}>
      <p>This project has no Git repository yet.</p>
      <button className={styles.initButton} disabled={busy} onClick={() => void run(initializeRepository)}>Initialize Git repository</button>
      <p className={styles.hint}>
        Version control keeps a local timeline of your manuscript so you can save checkpoints (commits), compare changes side by side, and safely restore earlier drafts whenever you need.
      </p>
    </div>}
    {status?.isRepository && <>
      <p className={styles.branch} title={status.branch}>Branch: {status.branch}</p>
      {hasUnsavedChanges && <p className={styles.warning}>Unsaved editor changes are not included. Save before staging.</p>}
      <div className={styles.files}>
        {group('Staged changes', staged, true)}
        {group('Changes', unstaged, false)}
        {group('Untracked files', untracked, false)}
        {!status.entries.length && <p className={styles.hint}>Working tree clean.</p>}
      </div>
      <form className={styles.commit} onSubmit={(event) => {
        event.preventDefault()
        const commitMessage = message.trim() || 'Saved version'
        void run((project) => commitChanges(project, commitMessage, status.indexFingerprint), 'Staged changes committed.')
      }}>
        <label htmlFor="git-commit-message">Commit message</label>
        <textarea id="git-commit-message" value={message} maxLength={4096} disabled={busy}
          onChange={(event) => setMessage(event.target.value)} rows={2} placeholder="Describe the changes (optional)" />
        <button type="submit" disabled={busy}>Save version</button>
        <p className={styles.hint}>Saves staged files (+), or all changed files automatically if none are staged.</p>
      </form>
      {(status.commits?.length ?? 0) > 0 && (
        <button type="button" className={styles.rollbackTrigger} disabled={busy}
          aria-label="Restore previous version (Rollback)"
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
              async (project) => {
                if (targetPaths && targetPaths.length > 0) {
                  for (const targetPath of targetPaths) {
                    await rollbackToCommit(project, commit.hash, targetPath)
                  }
                } else {
                  await rollbackToCommit(project, commit.hash)
                }
                await reloadActiveDocumentFromDisk(project)
              },
              targetPaths && targetPaths.length > 0
                ? targetPaths.length === 1
                  ? `Restored ${targetPaths[0]} to its version before ${commit.shortHash}.`
                  : `Restored ${targetPaths.length} files to their versions before ${commit.shortHash}.`
                : `Rolled back project to ${commit.shortHash}.`,
            )
          }}
        />
      )}
      {selection && <GitDiffDialog path={selection.path} staged={selection.staged} diff={diff} loading={busy}
        error={error} onClose={() => setSelection(null)} />}
      {menu && <div role="menu" aria-label={`${menu.entry.path} actions`} className={styles.contextMenu}
        style={{ left: menu.x, top: menu.y }} onPointerDown={(event) => event.stopPropagation()}>
        <button type="button" role="menuitem" disabled={busy}
          onClick={() => { const { entry, staged: isStaged } = menu; setMenu(null); void showDiff(entry.path, isStaged) }}>
          View Diff
        </button>
        <button type="button" role="menuitem" disabled={busy || menu.staged}
          onClick={() => { const { entry } = menu; setMenu(null); void run((project) => stageChange(project, entry.path)) }}>
          Add
        </button>
        <button type="button" role="menuitem" disabled={busy || !menu.staged}
          onClick={() => { const { entry } = menu; setMenu(null); void run((project) => unstageChange(project, entry.path)) }}>
          Remove from commit
        </button>
        <button type="button" role="menuitem" className={styles.dangerItem} disabled={busy}
          onClick={() => { const { entry } = menu; setMenu(null); setPendingRevert(entry) }}>
          Revert
        </button>
      </div>}
      {pendingRevert && <ConfirmDialog title="Revert changes"
        message={pendingRevert.indexStatus === '?' || pendingRevert.indexStatus === 'A'
          ? `Delete "${pendingRevert.path}"? This untracked or newly added file will be permanently removed.`
          : `Discard all changes in "${pendingRevert.path}" and restore it to HEAD? This cannot be undone.`}
        confirmLabel="Revert" danger onCancel={() => setPendingRevert(null)}
        onConfirm={() => {
          const entry = pendingRevert
          setPendingRevert(null)
          void run(async (project) => {
            await revertChange(project, entry.path)
            await reloadActiveDocumentFromDisk(project)
          }, `Reverted ${entry.path}.`)
        }} />}
    </>}
  </section>
}
