import { invoke } from '@tauri-apps/api/core'

export interface ExternalPluginVersion {
  dir: string
  version: string
  fingerprint: string
  name: string
  author: string
  description: string
  permissions: string[]
  granted: string[]
  installedAt: number
  source: string
  signature: string | null
}
export interface ExternalPluginRecord {
  latest: string
  current: string | null
  state: string
  versions: ExternalPluginVersion[]
}
export interface ExternalPluginRegistry { version: number; plugins: Record<string, ExternalPluginRecord> }
export interface ExternalPluginInstall {
  id: string
  name: string
  version: string
  author: string
  description: string
  permissions: string[]
  fingerprint: string
  alreadyInstalled: boolean
}
export interface ExternalPluginSummary {
  id: string
  name: string
  version: string
  author: string
  description: string
  permissions: string[]
  fingerprint: string
  state: string
  /** Newer bytes than the approved version exist, or nothing has been approved yet. */
  approved: boolean
}

/** Installs a package picked with the file dialog; the native side validates and never runs it. */
export const installExternalPlugin = (zipPath: string) => invoke<ExternalPluginInstall>('install_plugin_package', { zipPath })
export const listExternalPlugins = () => invoke<ExternalPluginRegistry>('list_external_plugins')
export const removeExternalPlugin = (id: string) => invoke<void>('remove_external_plugin', { id })

/** One row per plugin, describing its most recently installed version. */
export function summarizeExternalPlugins(registry: ExternalPluginRegistry): ExternalPluginSummary[] {
  return Object.entries(registry.plugins).flatMap(([id, record]) => {
    const latest = record.versions.find(version => version.dir === record.latest)
    if (!latest) return []
    return [{
      id,
      name: latest.name,
      version: latest.version,
      author: latest.author,
      description: latest.description,
      permissions: latest.permissions,
      fingerprint: latest.fingerprint,
      state: record.state,
      approved: record.current === record.latest,
    }]
  })
}
