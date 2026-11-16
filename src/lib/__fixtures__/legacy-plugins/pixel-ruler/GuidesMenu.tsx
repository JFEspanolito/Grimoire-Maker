import { usePageSettings as useSettingsStore } from '@grimoire/plugin-api'
import { PAGE_SIZES } from '@grimoire/plugin-api'
import { GUIDE_AXIS, type GuideAxis } from '@grimoire/plugin-api'
import { clamp, updateGuide, removeGuide } from './guideActions'
import styles from './Ruler.module.css'
import { useEffect, useRef } from 'react'

export function GuidesMenu() {
  const menu = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (menu.current && !menu.current.contains(event.target as Node)) menu.current.open = false
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [])
  const { pageSize, marginMm, rulerGuides, setRulerGuides } = useSettingsStore()
  const { widthMm, heightMm } = PAGE_SIZES[pageSize]
  const add = (axis: GuideAxis) => {
    const maximum = axis === GUIDE_AXIS.ROW ? heightMm : widthMm
    const store = useSettingsStore.getState()
    const last = store.rulerGuides.findLast((guide) => guide.axis === axis)?.positionMm ?? marginMm
    const positionMm = last + 10 < maximum ? last + 10 : marginMm
    store.setRulerGuides([...store.rulerGuides, { id: crypto.randomUUID(), axis, positionMm }])
  }
  return (
    <details ref={menu} aria-label="Guides" className={styles.controls} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => { if (event.key === 'Escape' && menu.current) { menu.current.open = false; menu.current.querySelector('summary')?.focus() } }}>
      <summary title="Visual row and column guides">Guides</summary>
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
  )
}
