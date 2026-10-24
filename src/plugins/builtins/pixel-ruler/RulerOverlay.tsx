import { useSettingsStore } from '../../../stores/settingsStore'
import { PAGE_SIZES } from '../../../types/document'

import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { GUIDE_AXIS, type GuideAxis, type RulerGuide } from '../../../types/ruler'
import styles from './Ruler.module.css'

import { useRulerState } from './rulerState'

const clamp = (value: number, maximum: number) => Math.round(Math.max(0, Math.min(value, maximum)) * 10) / 10
const updateGuide = (id: string, positionMm: number) => {
  const store = useSettingsStore.getState()
  store.setRulerGuides(store.rulerGuides.map((guide) => guide.id === id ? { ...guide, positionMm } : guide))
}
const removeGuide = (id: string) => {
  const store = useSettingsStore.getState()
  store.setRulerGuides(store.rulerGuides.filter((guide) => guide.id !== id))
}


function GuideLine({ guide, maximum, pageWidthMm }: { guide: RulerGuide; maximum: number; pageWidthMm: number }) {
  const row = guide.axis === GUIDE_AXIS.ROW
  const [draft, setDraft] = useState<number | null>(null)
  const drag = useRef<{ pointerId: number; start: number; position: number; mmPerPx: number } | null>(null)
  const position = draft ?? guide.positionMm
  const cancel = () => { drag.current = null; setDraft(null) }
  const start = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    const page = event.currentTarget.closest('.grimoire-page')
    const bounds = page?.getBoundingClientRect()
    if (!bounds?.width) return
    event.preventDefault()
    event.stopPropagation()
    drag.current = { pointerId: event.pointerId, start: row ? event.clientY : event.clientX, position: guide.positionMm, mmPerPx: pageWidthMm / bounds.width }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const move = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const active = drag.current
    if (!active || active.pointerId !== event.pointerId) return
    event.preventDefault()
    setDraft(clamp(active.position + ((row ? event.clientY : event.clientX) - active.start) * active.mmPerPx, maximum))
  }
  return <div className={row ? styles.row : styles.column} data-guide-axis={guide.axis}
    style={row ? { top: `${position}mm` } : { left: `${position}mm` }}>
    <button type="button" className={styles.handle} aria-label={`Move ${guide.axis} guide`}
      title={`${guide.axis === GUIDE_AXIS.ROW ? 'Row' : 'Column'}: ${position} mm. Drag or use arrow keys; Delete to remove.`}
      role="slider" aria-orientation={row ? 'vertical' : 'horizontal'} aria-valuemin={0} aria-valuemax={maximum} aria-valuenow={position}
      onPointerDown={start} onPointerMove={move} onPointerCancel={cancel} onLostPointerCapture={cancel}
      onPointerUp={(event) => {
        const active = drag.current
        if (!active || active.pointerId !== event.pointerId) return
        const next = clamp(active.position + ((row ? event.clientY : event.clientX) - active.start) * active.mmPerPx, maximum)
        cancel()
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
        updateGuide(guide.id, next)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { cancel(); return }
        if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); removeGuide(guide.id); return }
        const delta = event.key === (row ? 'ArrowDown' : 'ArrowRight') ? 1 : event.key === (row ? 'ArrowUp' : 'ArrowLeft') ? -1 : 0
        if (delta) { event.preventDefault(); updateGuide(guide.id, clamp(guide.positionMm + delta * (event.shiftKey ? 10 : 1), maximum)) }
      }} />
  </div>
}


export function RulerOverlay() {
  const visible = useRulerState((s) => s.visible)
  const { pageSize, marginMm, bleedMm, rulerGuides, setRulerGuides } = useSettingsStore()
  if (!visible) return null
  const { widthMm, heightMm, label } = PAGE_SIZES[pageSize]
  const add = (axis: GuideAxis) => {
    const maximum = axis === GUIDE_AXIS.ROW ? heightMm : widthMm
    const store = useSettingsStore.getState()
    const last = store.rulerGuides.findLast((guide) => guide.axis === axis)?.positionMm ?? marginMm
    const positionMm = last + 10 < maximum ? last + 10 : marginMm
    store.setRulerGuides([...store.rulerGuides, { id: crypto.randomUUID(), axis, positionMm }])
  }
  return <div className={styles.overlay} data-ruler-overlay="true">
    <span className={styles.measurements}>{label} · {widthMm}×{heightMm} mm · margin {marginMm} · bleed {bleedMm}</span>
    <div className={styles.margin} style={{ inset: `${marginMm}mm` }} aria-hidden="true" />
    <div className={styles.bleed} style={{ inset: `${bleedMm}mm` }} aria-hidden="true" />
    {rulerGuides.map((guide) => {
      const maximum = guide.axis === GUIDE_AXIS.ROW ? heightMm : widthMm
      return guide.positionMm <= maximum && <GuideLine key={guide.id} guide={guide} maximum={maximum} pageWidthMm={widthMm} />
    })}
    <details className={styles.controls} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
      <summary>Guides · {rulerGuides.length}</summary>
      <div className={styles.panel}>
        <div className={styles.actions}>
          <button type="button" aria-label="Add row guide" onClick={() => add(GUIDE_AXIS.ROW)}>+ Row</button>
          <button type="button" aria-label="Add column guide" onClick={() => add(GUIDE_AXIS.COLUMN)}>+ Column</button>
          <button type="button" disabled={!rulerGuides.length} onClick={() => setRulerGuides([])}>Clear</button>
        </div>
        <p>Visual only. Drag the edge handles or enter millimetres. Not printed.</p>
        <div className={styles.list}>
          {rulerGuides.map((guide, index) => {
            const maximum = guide.axis === GUIDE_AXIS.ROW ? heightMm : widthMm
            const label = `${guide.axis === GUIDE_AXIS.ROW ? 'Row' : 'Column'} ${index + 1}`
            return <div key={guide.id} className={styles.entry}>
              <label>{label}<input type="number" aria-label={`${label} position (mm)`} min={0} max={maximum} step={0.1} value={guide.positionMm}
                onChange={(event) => { const value = event.target.valueAsNumber; if (Number.isFinite(value)) updateGuide(guide.id, clamp(value, maximum)) }} /> mm</label>
              {guide.positionMm > maximum && <span title="Outside the current page size">Outside page</span>}
              <button type="button" aria-label={`Remove ${label}`} onClick={() => removeGuide(guide.id)}>×</button>
            </div>
          })}
        </div>
      </div>
    </details>
  </div>
}
