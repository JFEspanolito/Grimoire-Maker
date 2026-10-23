import { useEffect, type ReactNode } from 'react'
import { registerPlugin } from './plugin-manager'
import { pixelRuler } from './builtins/pixel-ruler'

const BUILTINS = [pixelRuler]

/** Activates built-in plugins once; registerPlugin is idempotent per id. */
export function PluginProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    BUILTINS.forEach(registerPlugin)
  }, [])
  return <>{children}</>
}
