import { invoke } from '@tauri-apps/api/core'
import { friendlyErrorMessage } from './errorLogging'

export interface ProjectText { path: string; before: string }
export interface ProjectChange { path: string; before: string; after: string }

/** Raw text (frontmatter included) of every project Markdown document, excluding Trash and hidden folders. */
export async function snapshotProjectTexts(root: string): Promise<ProjectText[]> {
  try {
    return await invoke<ProjectText[]>('snapshot_project_texts', { root })
  } catch (error) {
    throw new Error(friendlyErrorMessage(error))
  }
}

/**
 * Applies all changes on disk or none. Rejects when any changed file differs from `before`.
 * Pass the snapshot's paths as `knownPaths` to also reject documents added or removed meanwhile.
 * Resolves with the paths actually written (unchanged documents are skipped).
 */
export async function commitProjectReplace(root: string, changes: ProjectChange[], knownPaths?: string[]): Promise<string[]> {
  try {
    return await invoke<string[]>('commit_project_replace', { root, changes, knownPaths: knownPaths ?? null })
  } catch (error) {
    throw new Error(friendlyErrorMessage(error))
  }
}
