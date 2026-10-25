import { invoke } from '@tauri-apps/api/core'

export interface GitEntry {
  path: string
  originalPath: string | null
  indexStatus: string
  worktreeStatus: string
}

export interface RepositoryStatus {
  isRepository: boolean
  branch: string
  entries: GitEntry[]
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

export const diffChange = (workspace: string, path: string, staged: boolean) =>
  invoke<GitDiff>('git_diff', { workspace, path, staged })

export const commitChanges = (workspace: string, message: string, expectedIndex: string) =>
  invoke<void>('git_commit', { workspace, message, expectedIndex })

export type AutoCommitResult = 'committed' | 'indexUpdated' | 'unchanged' | 'noRepository' | 'gitUnavailable'

export const autoCommitChanges = (workspace: string, message: string) =>
  invoke<AutoCommitResult>('git_auto_commit', { workspace, message })
