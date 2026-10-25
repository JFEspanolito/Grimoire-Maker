import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { NodeViewContent, NodeViewWrapper, useEditorState, type NodeViewProps } from '@tiptap/react'
import { closeHistory } from '@tiptap/pm/history'
import { useSettingsStore } from '../../../stores/settingsStore'
import { PAGE_SIZES } from '../../../types/document'
import { editorSheetRect, editorStackOrigin, positionImageOnPage } from '../../../lib/imagePlacement'
import { moveContentBox } from '../../../lib/contentBoxes'
import { BOX_BORDER_MAX_PX, boxAttributes, boxBorderColor, boxBorderWidth, boxNumber } from './ContentBox'

/** Only the handle moves a group; its children retain ordinary editable text/table/image behavior. */
export function ContentBoxView({ node, editor, getPos, selected }: NodeViewProps) {
  const boxRef = useRef<HTMLDivElement>(null)
  const stopDrag = useRef<(() => void) | null>(null)
  const editing = useEditorState({ editor, selector: ({ editor: current }) => {
    const position = getPos()
    return typeof position === 'number' && current.state.selection.from > position
      && current.state.selection.to < position + node.nodeSize
  } })
  useEffect(() => () => stopDrag.current?.(), [])
  const { placement, widthMm, heightMm, xMm, yMm } = node.attrs
  const borderWidth = boxBorderWidth(node.attrs.borderWidth)
  const borderColor = boxBorderColor(node.attrs.borderColor)
  const attributes = boxAttributes(node.attrs)
  const change = (attrs: Record<string, unknown>) => {
    const position = getPos()
    if (typeof position !== 'number') return
    const current = editor.state.doc.nodeAt(position)
    if (current?.type.name !== 'standardContentBox') return
    editor.view.dispatch(closeHistory(editor.state.tr).setNodeMarkup(position, undefined, { ...current.attrs, ...attrs }))
  }
  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    const box = boxRef.current
    const page = box?.closest('.grimoire-page')
    if (!box || !page) return
    const bounds = editorSheetRect(page, box)
    const rect = box.getBoundingClientRect()
    if (!bounds.width || !rect.width) return
    event.preventDefault()
    event.stopPropagation()
    stopDrag.current?.()
    const from = getPos()
    if (typeof from !== 'number') return
    editor.commands.setNodeSelection(from)
    const handle = event.currentTarget
    const { pointerId, clientX, clientY } = event
    handle.setPointerCapture?.(pointerId)
    const pageSize = PAGE_SIZES[useSettingsStore.getState().pageSize]
    const original = box.style.cssText
    let position: ReturnType<typeof positionImageOnPage> = null
    let moved = false
    const cleanup = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', cancel)
      handle.removeEventListener('lostpointercapture', cancel)
      if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId)
      box.style.cssText = original
      stopDrag.current = null
    }
    const move = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) return
      const dx = next.clientX - clientX
      const dy = next.clientY - clientY
      if (!moved && Math.hypot(dx, dy) < 3) return
      moved = true
      if (placement === 'free') {
        position = positionImageOnPage(bounds, rect, pageSize.widthMm, pageSize.heightMm, dx, dy)
        if (position) {
          const origin = editorStackOrigin(page, box)
          position.yMm += (bounds.top - origin.top) * pageSize.widthMm / bounds.width
          box.style.left = `${position.xMm}mm`; box.style.top = `${position.yMm}mm`
        }
      } else {
        // Keep flow occupied during the gesture; do not turn a reorder into absolute placement.
        box.style.opacity = '0.55'
      }
      next.preventDefault()
    }
    const finish = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) return
      cleanup()
      if (!moved) return
      const current = getPos()
      if (typeof current !== 'number') return
      if (placement === 'free' && position) change({ ...position })
      else {
        const target = editor.view.posAtCoords({ left: next.clientX, top: next.clientY })
        if (target) moveContentBox(editor, current, target.pos)
      }
    }
    const cancel = (next: PointerEvent) => { if (next.pointerId === pointerId) cleanup() }
    stopDrag.current = cleanup
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', cancel)
    handle.addEventListener('lostpointercapture', cancel)
  }
  const setPlacement = (next: string) => {
    const box = boxRef.current
    const page = box?.closest('.grimoire-page')
    const bounds = box && page ? editorSheetRect(page, box) : undefined
    const rect = box?.getBoundingClientRect()
    if (next === 'free' && bounds?.width && rect) {
      const size = PAGE_SIZES[useSettingsStore.getState().pageSize]
      const position = positionImageOnPage(bounds, rect, size.widthMm, size.heightMm, 0, 0)
      if (position && box && page) position.yMm += (bounds.top - editorStackOrigin(page, box).top) * size.widthMm / bounds.width
      change({ placement: next, ...position, widthMm: boxNumber(rect.width * size.widthMm / bounds.width, 5) })
    } else change({ placement: next, xMm: null, yMm: null })
  }
  return (
    <NodeViewWrapper {...attributes} ref={boxRef} data-selected={selected || editing}
      style={{ width: widthMm === null ? undefined : `${boxNumber(widthMm, 5)}mm`,
        ...(borderWidth === null ? {} : { border: `${borderWidth}px solid ${borderColor}`, padding: '2mm', boxSizing: 'border-box' as const }),
        minHeight: heightMm === null ? undefined : `${boxNumber(heightMm, 5)}mm`,
        position: placement === 'free' ? 'absolute' : undefined,
        left: placement === 'free' ? `${boxNumber(xMm) ?? 0}mm` : undefined,
        top: placement === 'free' ? `${boxNumber(yMm) ?? 0}mm` : undefined }}>
      <div className="grimoire-box-controls" data-editor-only="true" contentEditable={false}>
        <button type="button" aria-label="Move content box" title="Drag to move the entire content box"
          onPointerDown={startDrag} onClick={() => { const position = getPos(); if (typeof position === 'number') editor.commands.setNodeSelection(position) }}>Move</button>
        <label>Placement <select aria-label="Content box placement" value={placement} onChange={(event) => setPlacement(event.target.value)}>
          <option value="flow">Push text</option><option value="free">Over text</option>
        </select></label>
        <label>Width <input aria-label="Content box width" title="Width in millimetres" type="number" min="5" max="500" placeholder="Auto"
          value={widthMm ?? ''} onChange={(event) => change({ widthMm: boxNumber(event.target.value, 5) })} /></label>
        <label>Height <input aria-label="Content box height" title="Minimum height in millimetres; expands to fit content" type="number" min="5" max="500" placeholder="Auto"
          value={heightMm ?? ''} onChange={(event) => change({ heightMm: boxNumber(event.target.value, 5) })} /></label>
        <label>Border <input aria-label="Content box border width" title="Border width in pixels; 0 removes it" type="number" min="0" max={BOX_BORDER_MAX_PX}
          value={borderWidth ?? 0} onChange={(event) => change({ borderWidth: boxBorderWidth(event.target.value) })} /></label>
        <input aria-label="Content box border color" title="Border color" type="color" value={borderColor}
          onChange={(event) => change({ borderColor: boxBorderColor(event.target.value) })} />
        <button type="button" aria-label="Delete content box" title="Delete the entire content box" onClick={() => {
          const position = getPos()
          if (typeof position !== 'number') return
          const current = editor.state.doc.nodeAt(position)
          if (current?.type.name !== 'standardContentBox') return
          editor.view.dispatch(closeHistory(editor.state.tr).delete(position, position + current.nodeSize))
        }}>Delete</button>
      </div>
      <NodeViewContent />
    </NodeViewWrapper>
  )
}
