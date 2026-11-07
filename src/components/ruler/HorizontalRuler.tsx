import { useCallback, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { Editor } from '@tiptap/react'
import { useSettingsStore } from '../../stores/settingsStore'
import { GUIDE_AXIS } from '../../types/ruler'
import { clamp, updateGuide, removeGuide } from './guideActions'
import { MAX_INDENT } from '../editor/extensions/blockFormat'
import styles from './Ruler.module.css'

export interface HorizontalRulerProps {
  widthMm: number
  marginMm: number
  onMarginChange?: (newMarginMm: number) => void
  editor?: Editor | null
}

interface DragState {
  type: 'left-margin' | 'right-margin' | 'indent' | 'guide'
  pointerId: number
  startX: number
  initialMm: number
  mmPerPx: number
  guideId?: string
}

export function HorizontalRuler({ widthMm, marginMm, onMarginChange, editor }: HorizontalRulerProps) {
  const rulerRef = useRef<HTMLDivElement>(null)
  const rulerGuides = useSettingsStore((s) => s.rulerGuides)

  const [draftMargin, setDraftMargin] = useState<number | null>(null)
  const [draftIndent, setDraftIndent] = useState<number | null>(null)
  const [dragInfo, setDragInfo] = useState<{ type: string; xMm: number; label: string } | null>(null)

  const dragRef = useRef<DragState | null>(null)

  const activeMargin = draftMargin ?? marginMm

  // Calculate current block indent (0..MAX_INDENT)
  const currentIndentLevel = useMemo(() => {
    if (!editor) return 0
    try {
      const isHeading = editor.isActive('heading')
      const isParagraph = editor.isActive('paragraph')
      if (!isHeading && !isParagraph) return 0
      const attrs = editor.getAttributes(isHeading ? 'heading' : 'paragraph')
      return Math.min(MAX_INDENT, Math.max(0, Number(attrs.indent) || 0))
    } catch {
      return 0
    }
  }, [editor, editor?.state?.selection])

  const activeIndentLevel = draftIndent ?? currentIndentLevel
  const indentStepMm = 10
  const indentX = activeMargin + activeIndentLevel * indentStepMm

  const cancelDrag = useCallback(() => {
    dragRef.current = null
    setDraftMargin(null)
    setDraftIndent(null)
    setDragInfo(null)
  }, [])

  const startDrag = (
    e: ReactPointerEvent<HTMLElement>,
    type: 'left-margin' | 'right-margin' | 'indent' | 'guide',
    initialMm: number,
    guideId?: string,
  ) => {
    if (e.button !== 0) return
    const container = rulerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    if (!rect.width) return

    e.preventDefault()
    e.stopPropagation()

    const mmPerPx = widthMm / rect.width
    dragRef.current = {
      type,
      pointerId: e.pointerId,
      startX: e.clientX,
      initialMm,
      mmPerPx,
      guideId,
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const active = dragRef.current
    if (!active || active.pointerId !== e.pointerId) return
    e.preventDefault()

    const deltaMm = (e.clientX - active.startX) * active.mmPerPx

    if (active.type === 'left-margin') {
      const maxMargin = Math.floor(widthMm / 2 - 10)
      const next = Math.max(5, Math.min(maxMargin, Math.round((active.initialMm + deltaMm) * 2) / 2))
      setDraftMargin(next)
      setDragInfo({ type: 'left-margin', xMm: next, label: `Margen: ${next.toFixed(1)} mm` })
    } else if (active.type === 'right-margin') {
      const maxMargin = Math.floor(widthMm / 2 - 10)
      const next = Math.max(5, Math.min(maxMargin, Math.round((active.initialMm - deltaMm) * 2) / 2))
      setDraftMargin(next)
      setDragInfo({ type: 'right-margin', xMm: widthMm - next, label: `Margen: ${next.toFixed(1)} mm` })
    } else if (active.type === 'indent') {
      const rawX = active.initialMm + deltaMm
      const step = Math.max(0, Math.min(MAX_INDENT, Math.round((rawX - activeMargin) / indentStepMm)))
      setDraftIndent(step)
      setDragInfo({
        type: 'indent',
        xMm: activeMargin + step * indentStepMm,
        label: `Sangría: Nivel ${step} (${(step * indentStepMm).toFixed(0)} mm)`,
      })
    } else if (active.type === 'guide' && active.guideId) {
      const next = clamp(active.initialMm + deltaMm, widthMm)
      updateGuide(active.guideId, next)
      setDragInfo({ type: 'guide', xMm: next, label: `Guía: ${next.toFixed(1)} mm` })
    }
  }

  const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const active = dragRef.current
    if (!active || active.pointerId !== e.pointerId) return
    e.preventDefault()

    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }

    if (active.type === 'left-margin' || active.type === 'right-margin') {
      if (draftMargin !== null && draftMargin !== marginMm) {
        onMarginChange?.(draftMargin)
      }
    } else if (active.type === 'indent') {
      if (draftIndent !== null && editor) {
        const isHeading = editor.isActive('heading')
        const blockType = isHeading ? 'heading' : 'paragraph'
        editor.chain().focus().updateAttributes(blockType, { indent: draftIndent }).run()
      }
    } else if (active.type === 'guide') {
      if (active.guideId) {
        const rawX = active.initialMm + (e.clientX - active.startX) * active.mmPerPx
        if (rawX <= 2 || rawX >= widthMm - 2) {
          removeGuide(active.guideId)
        }
      }
    }

    cancelDrag()
  }

  // Double click on margin to reset or set standard 15mm
  const handleMarginDoubleClick = () => {
    onMarginChange?.(15)
  }

  // SVG graduation generation
  const ticks = useMemo(() => {
    const items = []
    const totalMm = Math.ceil(widthMm)
    for (let mm = 0; mm <= totalMm; mm++) {
      const isCm = mm % 10 === 0
      const isHalfCm = mm % 5 === 0 && !isCm
      const isInsideBody = mm >= activeMargin && mm <= widthMm - activeMargin
      const strokeColor = isInsideBody
        ? isCm ? '#18181b' : isHalfCm ? '#52525b' : '#a1a1aa'
        : isCm ? '#52525b' : isHalfCm ? '#71717a' : '#a1a1aa'

      const height = isCm ? 11 : isHalfCm ? 7 : 4
      const y1 = 24 - height

      items.push(
        <line
          key={`t-${mm}`}
          x1={mm}
          x2={mm}
          y1={y1}
          y2={24}
          stroke={strokeColor}
          strokeWidth="0.5"
          vectorEffect="non-scaling-stroke"
        />,
      )

      if (isCm && mm > 0 && mm < totalMm) {
        items.push(
          <text
            key={`lbl-${mm}`}
            x={mm}
            y={10}
            fontSize="7"
            fontFamily="system-ui, -apple-system, sans-serif"
            fontWeight="500"
            fill={isInsideBody ? '#18181b' : '#71717a'}
            textAnchor="middle"
          >
            {mm / 10}
          </text>,
        )
      }
    }
    return items
  }, [widthMm, activeMargin])

  const columnGuides = useMemo(
    () => rulerGuides.filter((g) => g.axis === GUIDE_AXIS.COLUMN && g.positionMm <= widthMm),
    [rulerGuides, widthMm],
  )

  return (
    <div
      ref={rulerRef}
      className={styles.horizontalRuler}
      style={{ width: `${widthMm}mm` }}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={cancelDrag}
      title="Ruler: Drag margin markers or indent sliders."
    >
      {/* Visual background and metric scale SVG */}
      <svg
        viewBox={`0 0 ${widthMm} 24`}
        className={styles.rulerSvg}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {/* Base ruler background */}
        <rect x={0} y={0} width={widthMm} height={24} fill="#272623" />

        {/* Printable page body area */}
        <rect
          x={activeMargin}
          y={0}
          width={Math.max(0, widthMm - 2 * activeMargin)}
          height={24}
          fill="#fbfaf8"
        />

        {/* Left margin shaded background */}
        <rect x={0} y={0} width={activeMargin} height={24} fill="#383632" opacity="0.6" />

        {/* Right margin shaded background */}
        <rect
          x={widthMm - activeMargin}
          y={0}
          width={activeMargin}
          height={24}
          fill="#383632"
          opacity="0.6"
        />

        {/* Ticks and CM numbers */}
        {ticks}

        {/* Bottom divider line */}
        <line x1={0} y1={24} x2={widthMm} y2={24} stroke="#59564e" strokeWidth="1" />
      </svg>

      {/* Left Margin Slider */}
      <div
        data-handle="true"
        className={styles.marginHandle}
        style={{ left: `${activeMargin}mm` }}
        title={`Margen izquierdo: ${activeMargin.toFixed(1)} mm (Doble clic para restablecer)`}
        onPointerDown={(e) => startDrag(e, 'left-margin', activeMargin)}
        onDoubleClick={handleMarginDoubleClick}
        role="slider"
        aria-label="Margen izquierdo"
        aria-valuenow={activeMargin}
      >
        <div className={styles.marginHandleHeadTop} />
        <div className={styles.marginHandleLine} />
        <div className={styles.marginHandleHeadBottom} />
      </div>

      {/* Right Margin Slider */}
      <div
        data-handle="true"
        className={styles.marginHandle}
        style={{ left: `${widthMm - activeMargin}mm` }}
        title={`Margen derecho: ${activeMargin.toFixed(1)} mm (Doble clic para restablecer)`}
        onPointerDown={(e) => startDrag(e, 'right-margin', activeMargin)}
        onDoubleClick={handleMarginDoubleClick}
        role="slider"
        aria-label="Margen derecho"
        aria-valuenow={activeMargin}
      >
        <div className={styles.marginHandleHeadTop} />
        <div className={styles.marginHandleLine} />
        <div className={styles.marginHandleHeadBottom} />
      </div>

      {/* Paragraph Indent Slider (Word-style top triangle) */}
      {editor && (
        <div
          data-handle="true"
          className={styles.indentHandle}
          style={{ left: `${indentX}mm` }}
          title={`Sangría de párrafo: Nivel ${activeIndentLevel} (${(activeIndentLevel * indentStepMm).toFixed(0)} mm)`}
          onPointerDown={(e) => startDrag(e, 'indent', indentX)}
          role="slider"
          aria-label="Sangría de párrafo"
          aria-valuenow={activeIndentLevel}
        >
          <div className={styles.indentMarker} />
        </div>
      )}

      {/* Existing column guides on ruler */}
      {columnGuides.map((guide) => (
        <div
          key={guide.id}
          data-handle="true"
          role="slider"
          aria-label={`Guía de columna en ${guide.positionMm.toFixed(1)} mm`}
          aria-valuenow={guide.positionMm}
          className={styles.guideRulerMarker}
          style={{ left: `${guide.positionMm}mm` }}
          title={`Columna: ${guide.positionMm.toFixed(1)} mm (Doble clic o clic derecho para eliminar)`}
          onPointerDown={(e) => startDrag(e, 'guide', guide.positionMm, guide.id)}
          onDoubleClick={(e) => {
            e.stopPropagation()
            removeGuide(guide.id)
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
            removeGuide(guide.id)
          }}
        />
      ))}

      {/* Live drag tooltip and extended guideline */}
      {dragInfo && (
        <>
          <div
            className={styles.rulerTooltip}
            style={{ left: `${dragInfo.xMm}mm` }}
          >
            {dragInfo.label}
          </div>
          <div
            className={styles.rulerGuideline}
            style={{ left: `${dragInfo.xMm}mm` }}
          />
        </>
      )}
    </div>
  )
}
