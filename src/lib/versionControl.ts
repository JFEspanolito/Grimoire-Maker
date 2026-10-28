import { invoke } from '@tauri-apps/api/core'

export interface GitEntry {
  path: string
  originalPath: string | null
  indexStatus: string
  worktreeStatus: string
}

export interface GitCommit {
  hash: string
  shortHash: string
  subject: string
  timestamp: string
}

export interface RepositoryStatus {
  isRepository: boolean
  branch: string
  entries: GitEntry[]
  commits?: GitCommit[]
  indexFingerprint: string
}

export interface GitDiff {
  text: string
  binary: boolean
  truncated: boolean
}

export const getRepositoryStatus = (workspace: string) =>
  invoke<RepositoryStatus>('git_status', { workspace })

export const initializeRepository = (workspace: string) =>
  invoke<void>('git_init', { workspace })

export const stageChange = (workspace: string, path: string) =>
  invoke<void>('git_stage', { workspace, path })

export const unstageChange = (workspace: string, path: string) =>
  invoke<void>('git_unstage', { workspace, path })

export const revertChange = (workspace: string, path: string) =>
  invoke<void>('git_revert', { workspace, path })

export const rollbackToCommit = (workspace: string, commit: string, path?: string) =>
  invoke<void>('git_rollback', { workspace, commit, path: path ?? null })

export const diffCommit = (workspace: string, commit: string, path?: string) =>
  invoke<GitDiff>('git_commit_diff', { workspace, commit, path: path ?? null })

export const diffChange = (workspace: string, path: string, staged: boolean) =>
  invoke<GitDiff>('git_diff', { workspace, path, staged })

export const commitChanges = (workspace: string, message: string, expectedIndex: string) =>
  invoke<void>('git_commit', { workspace, message, expectedIndex })

export type AutoCommitResult = 'committed' | 'indexUpdated' | 'unchanged' | 'noRepository' | 'gitUnavailable'

export const autoCommitChanges = (workspace: string, message: string) =>
  invoke<AutoCommitResult>('git_auto_commit', { workspace, message })
