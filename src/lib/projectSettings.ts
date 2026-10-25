import { exists, readTextFile, writeTextFile, rename } from '@tauri-apps/plugin-fs'
import { validateContributors, type Contributor } from './projectContributors'

export interface ProjectSettings {
  /** Shared display name for the book; editing it never renames the project folder. */
  name: string
  author: string
  coAuthor: string
  coAuthors?: Contributor[]
  artists?: Contributor[]
}
export const EMPTY_PROJECT: ProjectSettings = { name: '', author: '', coAuthor: '' }
const filePath = (root: string) => `${root.replace(/[\\/]$/, '')}/.grimoire-project.json`

async function readMetadata(root: string): Promise<Record<string, unknown>> {
  const path = filePath(root)
  if (!(await exists(path))) return {}
  const value: unknown = JSON.parse(await readTextFile(path))
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid project settings. Existing file was not changed.')
  return value as Record<string, unknown>
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
  return result
}

export async function loadProjectSettings(root: string): Promise<ProjectSettings> {
  return validate(await readMetadata(root))
}

export async function saveProjectSettings(root: string, settings: ProjectSettings): Promise<void> {
  const previous = await readMetadata(root)
  validate(previous)
  const next = { ...previous, ...validate({ ...settings }) }
  const temporary = `${filePath(root)}.${crypto.randomUUID()}.tmp`
  await writeTextFile(temporary, JSON.stringify(next, null, 2), { createNew: true })
  await rename(temporary, filePath(root))
}
