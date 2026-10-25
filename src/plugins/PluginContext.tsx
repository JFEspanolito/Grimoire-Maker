import type { ReactNode } from 'react'

/** Plugin activation belongs to the configured mod catalog, not bundled imports. */
export function PluginProvider({ children }: { children: ReactNode }) {
  return <>{children}</>
}
