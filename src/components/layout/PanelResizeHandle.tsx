import { useRef } from 'react'
import styles from './PanelResizeHandle.module.css'

interface PanelResizeHandleProps {
  label: string
  controls: string
  width: number
  otherWidth: number
  direction: 1 | -1
  onResize: (width: number) => void
}

/** Resize toward the workspace without changing the opposite panel. */
export function PanelResizeHandle({ label, controls, width, otherWidth, direction, onResize }: PanelResizeHandleProps) {
  const drag = useRef<{ pointerId: number; x: number; width: number } | null>(null)
  const minimum = 160
  const maximum = Math.max(minimum, Math.min(480, window.innerWidth - otherWidth - 250))
  const resize = (value: number) => onResize(Math.round(Math.max(minimum, Math.min(maximum, value))))
  return <div role="separator" tabIndex={0} aria-label={label} aria-controls={controls}
    aria-orientation="vertical" aria-valuemin={minimum} aria-valuemax={Math.max(maximum, width)} aria-valuenow={width}
    title="Drag to resize; use Left and Right arrow keys" className={styles.handle}
    onPointerDown={event => {
      if (event.button !== 0) return
      event.preventDefault()
      event.currentTarget.focus()
      event.currentTarget.setPointerCapture?.(event.pointerId)
      drag.current = { pointerId: event.pointerId, x: event.clientX, width }
    }}
    onPointerMove={event => {
      const start = drag.current
      if (start?.pointerId === event.pointerId) resize(start.width + direction * (event.clientX - start.x))
    }}
    onPointerUp={event => {
      if (drag.current?.pointerId !== event.pointerId) return
      drag.current = null
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    }}
    onPointerCancel={() => { drag.current = null }}
    onLostPointerCapture={() => { drag.current = null }}
    onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      resize(event.key === 'Home' ? minimum : event.key === 'End' ? maximum
        : width + (event.key === 'ArrowRight' ? 10 : -10) * direction)
    }} />
}
