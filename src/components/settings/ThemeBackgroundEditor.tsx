import { useTranslation } from '../../lib/i18n'
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { moveDecoration, type ThemeDecoration } from '../../lib/themeDecorations'
import styles from './ThemeCustomizer.module.css'

interface Props {
  images: ThemeDecoration[]
  onChange: (images: ThemeDecoration[]) => void
  onImport: () => void
  disabled: boolean
  pageWidthMm: number
  pageHeightMm: number
  background: string
  foreground: string
}

export function ThemeBackgroundEditor({ images, onChange, onImport, disabled, pageWidthMm, pageHeightMm, background, foreground }: Props) {
  const { t } = useTranslation();
  const [selectedId, select] = useState<string | null>(null)
  const page = useRef<HTMLDivElement>(null)
  const stopDrag = useRef<(() => void) | null>(null)
  const selected = images.find(item => item.id === selectedId) ?? images.at(-1)
  useEffect(() => () => stopDrag.current?.(), [])
  const update = (next: ThemeDecoration) => onChange(images.map(item => item.id === next.id ? next : item))
  const drag = (event: ReactPointerEvent<HTMLButtonElement>, item: ThemeDecoration) => {
    if (disabled || event.button !== 0 || !page.current) return
    const bounds = page.current.getBoundingClientRect()
    if (!bounds.width) return
    event.preventDefault()
    event.stopPropagation()
    select(item.id)
    stopDrag.current?.()
    const element = event.currentTarget
    const original = element.style.cssText
    const { clientX, clientY, pointerId } = event
    let next = item
    element.setPointerCapture?.(pointerId)
    const cleanup = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', cancel)
      element.removeEventListener('lostpointercapture', cancel)
      if (element.hasPointerCapture?.(pointerId)) element.releasePointerCapture(pointerId)
      element.style.cssText = original
      stopDrag.current = null
    }
    const move = (pointer: PointerEvent) => {
      if (pointer.pointerId !== pointerId) return
      const scale = pageWidthMm / bounds.width
      next = moveDecoration(item, (pointer.clientX - clientX) * scale, (pointer.clientY - clientY) * scale, pageWidthMm, pageHeightMm)
      element.style.left = `${next.xMm / pageWidthMm * 100}%`
      const top = next.anchor === 'footer' ? pageHeightMm - next.yMm - next.heightMm : next.yMm
      element.style.top = `${top / pageHeightMm * 100}%`
      pointer.preventDefault()
    }
    const finish = (pointer: PointerEvent) => { if (pointer.pointerId === pointerId) { cleanup(); update(next) } }
    const cancel = (pointer: PointerEvent) => { if (pointer.pointerId === pointerId) cleanup() }
    stopDrag.current = cleanup
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', cancel)
    element.addEventListener('lostpointercapture', cancel)
  }
  return <section className={styles.backgrounds} aria-labelledby="theme-backgrounds-title">
    <div className={styles.header}><h3 id="theme-backgrounds-title">{t('ui.page_backgrounds')}</h3><button type="button" disabled={disabled} onClick={onImport}>{t('ui.import_image')}</button></div>
    <p className={styles.description}>{t('ui.drag_images_on_the_sheet_they_repeat_behind_the_text_on_every_page_using_this_th')}</p>
    <div className={styles.backgroundWorkspace}>
      <div className={styles.backgroundControls}>
        {selected ? <>
          <label>{t('ui.image')}<select aria-label={t('ui.background_image')} disabled={disabled} value={selected.id} onChange={event => select(event.target.value)}>
            {images.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>
          <label>{t('ui.anchor')}<select aria-label={t('ui.background_anchor')} disabled={disabled} value={selected.anchor}
            onChange={event => update({ ...selected, anchor: event.target.value === 'footer' ? 'footer' : 'header' })}>
            <option value="header">{t('ui.header')}</option><option value="footer">{t('ui.footer')}</option>
          </select></label>
          {(['xMm', 'yMm', 'widthMm'] as const).map((key, index) => <label key={key}>{[t('ui.left'), t('ui.edge_offset'), t('ui.width')][index]}
            <input type="number" aria-label={t((['ui.backgroundLeft', 'ui.backgroundOffset', 'ui.backgroundWidth'] as const)[index])} title={t('ui.millimetres')} disabled={disabled}
              min={key === 'widthMm' ? 1 : 0} max={key === 'widthMm' ? pageWidthMm : 1000} step="1" value={Math.round(selected[key] * 100) / 100}
              onChange={event => {
                if (event.target.value === '') return
                const value = Number(event.target.value)
                if (!Number.isFinite(value) || value < (key === 'widthMm' ? 1 : 0) || value > 1000) return
                const height = key === 'widthMm' ? selected.heightMm * value / selected.widthMm : selected.heightMm
                if (height > 1000 || height < 1) return
                update({ ...selected, [key]: value, heightMm: height })
              }} />
          </label>)}
          <button type="button" disabled={disabled} onClick={() => onChange(images.filter(item => item.id !== selected.id))}>{t('ui.remove_image')}</button>
        </> : <p className={styles.description}>{t('ui.import_flowers_borders_or_other_artwork_to_begin_transparent_png_images_work_wel')}</p>}
      </div>
      <div ref={page} className={styles.backgroundPage} aria-label={t('ui.background_placement_preview')}
        style={{ aspectRatio: `${pageWidthMm} / ${pageHeightMm}`, background, color: foreground }}>
        <div className={styles.backgroundSample} aria-hidden="true"><strong>{t('ui.chapter_one')}</strong><p>{t('ui.your_text_stays_above_the_background_artwork')}</p></div>
        {images.map((item, index) => <button key={item.id} type="button" className={styles.backgroundImage}
          aria-label={t('ui.moveBackground', { name: item.name })} aria-pressed={selected?.id === item.id} disabled={disabled}
          style={{ left: `${item.xMm / pageWidthMm * 100}%`, top: `${(item.anchor === 'footer' ? pageHeightMm - item.yMm - item.heightMm : item.yMm) / pageHeightMm * 100}%`,
            width: `${item.widthMm / pageWidthMm * 100}%`, height: `${item.heightMm / pageHeightMm * 100}%`, zIndex: selected?.id === item.id ? 35 : images.length - index }}
          onPointerDown={event => drag(event, item)} onClick={() => select(item.id)}
          onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
            event.preventDefault()
            const step = event.shiftKey ? 10 : 1
            update(moveDecoration(item, event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0,
              event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0, pageWidthMm, pageHeightMm))
          }}><img src={item.dataUrl} alt="" draggable={false} /></button>)}
      </div>
    </div>
  </section>
}
