import { useEffect, useEffectEvent, useRef } from 'react'

/** Native non-passive listener prevents WebView zoom, not ordinary scrolling. */
export function useWheelZoom(zoom: number, setZoom: (value: number) => void, steps: readonly number[]) {
  const ref = useRef<HTMLDivElement>(null)
  const onWheel = useEffectEvent((event: WheelEvent) => {
    if (!event.ctrlKey || !event.deltaY || event.defaultPrevented || document.querySelector('dialog[open]')) return
    event.preventDefault()
    const next = event.deltaY < 0
      ? steps.find(value => value > zoom)
      : steps.findLast(value => value < zoom)
    if (next !== undefined) setZoom(next)
  })

  useEffect(() => {
    const element = ref.current
    if (!element) return
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [])

  return ref
}
