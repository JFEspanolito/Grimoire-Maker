import { useEffect, type ReactNode } from 'react'
import { registerPlugin } from './plugin-manager'
import { pixelRuler } from './builtins/pixel-ruler'
import { zoomPlugin } from './builtins/zoom'

const BUILTINS = [pixelRuler, zoomPlugin]

/** Activates built-in plugins once; registerPlugin is idempotent per id. */
export function PluginProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    BUILTINS.forEach(registerPlugin)
  }, [])
  return <>{children}</>
}
