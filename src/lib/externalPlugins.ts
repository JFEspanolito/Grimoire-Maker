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
  sdkVersion: number
  consentAt: number | null
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
export interface ExternalPluginRegistry { version: number; disabledAll: boolean; plugins: Record<string, ExternalPluginRecord> }
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
  sdkVersion: number
  state: string
  /** Newer bytes than the approved version exist, or nothing has been approved yet. */
  approved: boolean
}

/** Installs a package picked with the file dialog; the native side validates and never runs it. */
export const installExternalPlugin = (zipPath: string) => invoke<ExternalPluginInstall>('install_plugin_package', { zipPath })
export const listExternalPlugins = () => invoke<ExternalPluginRegistry>('list_external_plugins')
export const removeExternalPlugin = (id: string) => invoke<void>('remove_external_plugin', { id })

export interface ToolbarItem {
  id: string
  type: 'button' | 'select'
  label: string
  command: string
  options: { value: string; label: string }[]
}
/** What the runtime needs to start one approved, active plugin; integrity was just re-verified natively. */
export interface ExternalPluginEntry {
  id: string
  version: string
  fingerprint: string
  sdkVersion: number
  permissions: string[]
  toolbar: ToolbarItem[]
  source: string
}

/** The approval is bound to this exact version, fingerprint, permission set and SDK version. */
export const grantPluginConsent = (plugin: Pick<ExternalPluginSummary, 'id' | 'version' | 'fingerprint' | 'permissions' | 'sdkVersion'>) =>
  invoke<void>('grant_plugin_consent', {
    id: plugin.id, version: plugin.version, fingerprint: plugin.fingerprint, granted: plugin.permissions, sdkVersion: plugin.sdkVersion,
  })
export const revokePluginConsent = (id: string) => invoke<void>('revoke_plugin_consent', { id })
export const setExternalPluginActive = (id: string, active: boolean) => invoke<void>('set_external_plugin_active', { id, active })
export const stopExternalPlugin = (id: string, reason: string) => invoke<void>('stop_external_plugin', { id, reason })
export const setExternalPluginsDisabled = (disabled: boolean) => invoke<void>('set_external_plugins_disabled', { disabled })
export const readExternalPluginEntry = (id: string) => invoke<ExternalPluginEntry>('read_external_plugin_entry', { id })
export const logExternalPluginEvent = (id: string, event: string, detail: string) =>
  invoke<void>('log_external_plugin_event', { id, event, detail })

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
      sdkVersion: latest.sdkVersion,
      state: record.state,
      approved: record.current === record.latest,
    }]
  })
}
