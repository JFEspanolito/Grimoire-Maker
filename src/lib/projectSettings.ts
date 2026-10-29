import { exists, readTextFile, writeTextFile, rename } from '@tauri-apps/plugin-fs'
import { invoke } from '@tauri-apps/api/core'
import { validateContributors, type Contributor } from './projectContributors'
import type { DocumentOrder } from './documentOrder'

export interface ProjectSettings {
  /** Shared display name for the book; editing it never renames the project folder. */
  name: string
  author: string
  coAuthor: string
  coAuthors?: Contributor[]
  artists?: Contributor[]
  /** Which documents the PDF contains and in what order; absent means every Draft document. */
  documentOrder?: DocumentOrder
}
export const EMPTY_PROJECT: ProjectSettings = { name: '', author: '', coAuthor: '' }
const filePath = (root: string) => `${root.replace(/[\\/]$/, '')}/.grimoire-project.json`

async function readMetadata(root: string): Promise<Record<string, unknown>> {
  await invoke('prepare_project_metadata', { root, token: null })
  const path = filePath(root)
  if (!(await exists(path))) return {}
  const value: unknown = JSON.parse(await readTextFile(path))
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid project settings. Existing file was not changed.')
  return value as Record<string, unknown>
}

const MAX_ORDER_ENTRIES = 5000
function validatePaths(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_ORDER_ENTRIES) throw new Error('Document order must be a list of at most 5000 documents.')
  return value.map((path) => {
    if (typeof path !== 'string' || !path || path.length > 1000 || path.startsWith('/') || /(^|\/)\.\.(\/|$)|\\|^[A-Za-z]:/.test(path)) {
      throw new Error('Document order may only contain paths inside the project.')
    }
    return path
  })
}
function validateDocumentOrder(value: unknown): DocumentOrder {
  if (!value || typeof value !== 'object') throw new Error('Document order must be an object.')
  const { order, excluded } = value as Record<string, unknown>
  return { order: validatePaths(order), excluded: validatePaths(excluded ?? []) }
}

function validate(value: Record<string, unknown>): ProjectSettings {
  const result = { ...EMPTY_PROJECT }
  for (const key of ['name', 'author', 'coAuthor'] as const) {
    if (value[key] === undefined) continue
    if (typeof value[key] !== 'string' || value[key].length > 500) throw new Error(`Project ${key} must be text of at most 500 characters.`)
    result[key] = value[key]
  }
  for (const key of ['coAuthors', 'artists'] as const) {
    if (value[key] !== undefined) result[key] = validateContributors(value[key])
  }
  if (value.documentOrder !== undefined) result.documentOrder = validateDocumentOrder(value.documentOrder)
  return result
}

export async function loadProjectSettings(root: string): Promise<ProjectSettings> {
  return validate(await readMetadata(root))
}

export async function saveProjectSettings(root: string, settings: ProjectSettings): Promise<void> {
  const previous = await readMetadata(root)
  validate(previous)
  const next = { ...previous, ...validate({ ...settings }) }
  const token = crypto.randomUUID()
  await invoke('prepare_project_metadata', { root, token })
  const temporary = `${filePath(root)}.${token}.tmp`
  await writeTextFile(temporary, JSON.stringify(next, null, 2), { createNew: true })
  await rename(temporary, filePath(root))
}
