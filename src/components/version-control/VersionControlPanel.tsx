import { reportError } from '../../lib/errorLogging'
import { useEffect, useRef, useState } from 'react'
import { commitChanges, diffChange, getRepositoryStatus, initializeRepository, stageChange, unstageChange } from '../../lib/versionControl'
import type { GitDiff, GitEntry, RepositoryStatus } from '../../lib/versionControl'
import styles from './VersionControlPanel.module.css'
import { notifyRepositoryChanged, REPOSITORY_CHANGED } from '../../lib/repositoryEvents'
import { GitDiffDialog } from './GitDiffDialog'

interface VersionControlPanelProps {
  workspace: string | null
  hasUnsavedChanges?: boolean
}

interface Selection {
  path: string
  staged: boolean
}

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error)

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
        {entries.map((entry) => <li key={entry.path}>
          <button className={styles.file} disabled={busy} onClick={() => void showDiff(entry.path, isStaged)}
            title={entry.originalPath ? `${entry.originalPath} → ${entry.path}` : entry.path}
            aria-label={`View ${isStaged ? 'staged' : 'unstaged'} diff for ${entry.path}`}>
            <span className={styles.code}>{isStaged ? entry.indexStatus : entry.worktreeStatus}</span>
            <span>{entry.path}</span>
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
      <p>This project has no Git repository.</p>
      <button disabled={busy} onClick={() => void run(initializeRepository)}>Initialize Git repository</button>
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
        if (!message.trim() || !staged.length) return
        void run((project) => commitChanges(project, message, status.indexFingerprint), 'Staged changes committed.')
      }}>
        <label htmlFor="git-commit-message">Commit message</label>
        <textarea id="git-commit-message" value={message} maxLength={4096} disabled={busy}
          onChange={(event) => setMessage(event.target.value)} rows={2} placeholder="Describe the staged changes" />
        <button type="submit" disabled={busy || !staged.length || !message.trim()}>Commit staged ({staged.length})</button>
        <p className={styles.hint}>Commits all staged files only. Git hooks and signing are bypassed. No remote operations.</p>
      </form>
      {selection && <GitDiffDialog path={selection.path} staged={selection.staged} diff={diff} loading={busy}
        error={error} onClose={() => setSelection(null)} />}
    </>}
  </section>
}
