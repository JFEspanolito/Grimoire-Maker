import { useEffect, useEffectEvent, useRef } from 'react'
import { useSettingsStore } from '../stores/settingsStore'
import { isTauri, useFileSystem } from './useFileSystem'

export function useAutoSave(ready: boolean): void {
  const seconds = useSettingsStore(state => state.autoSaveSeconds)
  const { autoSave } = useFileSystem()
  const save = useEffectEvent(() => autoSave())
  const running = useRef(false)

  useEffect(() => {
    if (!ready || !isTauri()) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const schedule = () => { timer = setTimeout(() => void tick(), seconds * 1000) }
    async function tick() {
      if (running.current) { schedule(); return }
      running.current = true
      try { await save() }
      catch { /* The shared save action reports failures and retains dirty buffers. */ }
      finally {
        running.current = false
        if (!cancelled) schedule()
      }
    }
    schedule()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [ready, seconds])
}
