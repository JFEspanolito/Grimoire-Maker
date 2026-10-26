import { exists, readTextFile, rename, writeTextFile } from '@tauri-apps/plugin-fs'

const MAX_BYTES = 1024 * 1024
const PLUGIN_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/i

function dataFile(root: string, pluginId: string): string {
  if (!PLUGIN_ID.test(pluginId)) throw new Error(`Invalid plugin id: ${pluginId}`)
  return `${root.replace(/[\\/]+$/, '')}/.grimoire-plugin-${pluginId}.json`
}

/** A plugin's private text data for one project; null when it has not saved anything yet. */
export async function readProjectData(root: string, pluginId: string): Promise<string | null> {
  const path = dataFile(root, pluginId)
  if (!(await exists(path))) return null
  const text = await readTextFile(path)
  if (new TextEncoder().encode(text).length > MAX_BYTES) throw new Error('Plugin project data exceeds 1 MiB')
  return text
}

/** Publishes the whole file at once, so a failed write never truncates the previous data. */
export async function writeProjectData(root: string, pluginId: string, text: string): Promise<void> {
  if (new TextEncoder().encode(text).length > MAX_BYTES) throw new Error('Plugin project data exceeds 1 MiB')
  const path = dataFile(root, pluginId)
  const temporary = `${path}.${crypto.randomUUID()}.tmp`
  await writeTextFile(temporary, text, { createNew: true })
  await rename(temporary, path)
}
