import { getVersion } from '@tauri-apps/api/app'
import { isTauri } from '@tauri-apps/api/core'
import packageSource from '../../package.json?raw'

export interface UpdateInfo {
  hasUpdate: boolean
  currentVersion: string
  latestVersion: string
  releaseUrl: string
}

function parseVersion(version: string) {
  if (version.length > 128) return null
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?(?:\+[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/.exec(version)
  if (!match) return null
  const pre = match[4]?.split('.') ?? []
  if (pre.some((part) => /^\d+$/.test(part) && part.length > 1 && part.startsWith('0'))) return null
  return { core: match.slice(1, 4).map(BigInt), pre }
}

/** SemVer precedence, including prereleases; build metadata does not affect precedence. */
export function isNewerVersion(latest: string, current: string): boolean {
  const a = parseVersion(latest)
  const b = parseVersion(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) {
    if (a.core[i] !== b.core[i]) return a.core[i] > b.core[i]
  }
  if (!a.pre.length || !b.pre.length) return !a.pre.length && b.pre.length > 0
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    if (a.pre[i] === undefined) return false
    if (b.pre[i] === undefined) return true
    if (a.pre[i] === b.pre[i]) continue
    const an = /^\d+$/.test(a.pre[i])
    const bn = /^\d+$/.test(b.pre[i])
    if (an && bn) return BigInt(a.pre[i]) > BigInt(b.pre[i])
    if (an !== bn) return !an
    return a.pre[i] > b.pre[i]
  }
  return false
}

/** Optional, read-only check. Network, IPC, validation and cancellation failures return null. */
export async function checkForAppUpdates(signal?: AbortSignal): Promise<UpdateInfo | null> {
  const controller = new AbortController()
  let cancel = () => {}
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const stopped = new Promise<null>((resolve) => {
      cancel = () => { controller.abort(); resolve(null) }
      timer = setTimeout(cancel, 8000)
      signal?.addEventListener('abort', cancel, { once: true })
    })
    if (signal?.aborted) { cancel(); return null }
    const query = async (): Promise<UpdateInfo | null> => {
      const currentVersion = isTauri() ? await getVersion() : (JSON.parse(packageSource) as { version: string }).version
      if (controller.signal.aborted) return null
      const response = await fetch('https://api.github.com/repos/JFEspanolito/Grimoire-Maker/releases/latest', {
        signal: controller.signal, credentials: 'omit', headers: { Accept: 'application/vnd.github+json' },
      })
      if (!response.ok) return null
      const data: unknown = await response.json()
      if (!data || typeof data !== 'object' || !('tag_name' in data) || typeof data.tag_name !== 'string'
        || !('html_url' in data) || typeof data.html_url !== 'string'
        || ('draft' in data && data.draft) || ('prerelease' in data && data.prerelease)) return null
      if (!parseVersion(data.tag_name) || !parseVersion(currentVersion)) return null
      const url = new URL(data.html_url)
      if (url.origin !== 'https://github.com' || url.username || url.password
        || !url.pathname.startsWith('/JFEspanolito/Grimoire-Maker/releases/tag/')) return null
      return { hasUpdate: isNewerVersion(data.tag_name, currentVersion), currentVersion, latestVersion: data.tag_name, releaseUrl: url.href }
    }
    return await Promise.race([query(), stopped])
  } catch {
    return null
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
  }
}
