import { useEffect, useRef } from 'react'
import { useSettingsStore } from '../../stores/settingsStore'
import { PAGE_SIZES } from '../../types/document'
import { GUIDE_AXIS, type GuideAxis } from '../../types/ruler'
import { clamp, updateGuide, removeGuide } from './guideActions'
import { useTranslation } from '../../lib/i18n'
import styles from './Ruler.module.css'

export function GuidesMenu() {
  const { t } = useTranslation()
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
    <details ref={menu} aria-label={t('guides.title')} className={styles.controls} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => { if (event.key === 'Escape' && menu.current) { menu.current.open = false; menu.current.querySelector('summary')?.focus() } }}>
      <summary title={t('guides.tooltip')}>{t('guides.title')}</summary>
      <div className={styles.panel}>
        <div className={styles.actions}>
          <button type="button" aria-label={t('guides.addRowAria')} onClick={() => add(GUIDE_AXIS.ROW)}>{t('guides.addRow')}</button>
          <button type="button" aria-label={t('guides.addColumnAria')} onClick={() => add(GUIDE_AXIS.COLUMN)}>{t('guides.addColumn')}</button>
          <button type="button" disabled={!rulerGuides.length} onClick={() => setRulerGuides([])}>{t('guides.clear')}</button>
        </div>
        <p>{t('guides.hint')}</p>
        <div className={styles.list}>
          {rulerGuides.map((guide, index) => {
            const maximum = guide.axis === GUIDE_AXIS.ROW ? heightMm : widthMm
            const label = `${guide.axis === GUIDE_AXIS.ROW ? t('guides.row') : t('guides.column')} ${index + 1}`
            return <div key={guide.id} className={styles.entry}>
              <label>{label}<input type="number" aria-label={`${label} ${t('guides.positionMm')}`} min={0} max={maximum} step={0.1} value={guide.positionMm}
                onChange={(event) => { const value = event.target.valueAsNumber; if (Number.isFinite(value)) updateGuide(guide.id, clamp(value, maximum)) }} /> mm</label>
              {guide.positionMm > maximum && <span title="Outside the current page size">{t('guides.outsidePage')}</span>}
              <button type="button" aria-label={`${t('guides.remove')} ${label}`} onClick={() => removeGuide(guide.id)}>×</button>
            </div>
          })}
        </div>
      </div>
    </details>
  )
}
