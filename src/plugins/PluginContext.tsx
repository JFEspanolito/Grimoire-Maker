import type { ReactNode } from 'react'

/** The configured catalog controls which compiled official plugins are active. */
export function PluginProvider({ children }: { children: ReactNode }) {
  return <>{children}</>
}
