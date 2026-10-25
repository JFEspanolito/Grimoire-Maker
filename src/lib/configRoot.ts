import { invoke, isTauri } from '@tauri-apps/api/core'
import { configDir } from '@tauri-apps/api/path'

/** The desktop backend prepares and owns this root; renderer paths never authorize migration. */
export async function configRoot(): Promise<string> {
  if (isTauri()) return invoke<string>('config_root')
  const parent = (await configDir()).replaceAll('\\', '/').replace(/\/$/, '')
  return `${parent}/GriomoireMaker`
}
