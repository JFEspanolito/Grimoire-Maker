import { useEffect, useRef } from 'react'
import { usePluginRegistry } from './plugin-manager'
import type { PluginSurface } from '../types/plugin'
import { reportError } from '../lib/errorLogging'

/** Mount generic behaviors on a host-owned page surface and release on change/unmount. */
export function usePluginSurface(kind: PluginSurface['kind'], zoom: number, setZoom: PluginSurface['setZoom']) {
  const element = useRef<HTMLDivElement>(null)
  const behaviors = usePluginRegistry(state => state.pageBehaviors)
  useEffect(() => {
    if (!element.current) return
    const disposers: (() => void)[] = []
    for (const behavior of behaviors) {
      try { disposers.push(behavior.mount(element.current, { kind, zoom, setZoom })) }
      catch (error) { reportError('plugin.surface', error) }
    }
    return () => {
      for (const dispose of disposers.reverse()) {
        try { dispose() } catch (error) { reportError('plugin.surface.cleanup', error) }
      }
    }
  }, [behaviors, kind, zoom, setZoom])
  return element
}
