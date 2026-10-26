import { useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { Fragment, Slice } from '@tiptap/pm/model'
import { NodeSelection } from '@tiptap/pm/state'
import { dropPoint } from '@tiptap/pm/transform'
import { useDocumentStore } from '../../../stores/documentStore'
import { useSettingsStore } from '../../../stores/settingsStore'
import { loadImageUrl, revokeImageUrl } from '../../../lib/images'
import {
  editorSheetRect,
  editorSpreadPair,
  editorStackOrigin,
  isOutsideContentMargin,
  positionImageInSpread,
  positionImageOnPage,
} from '../../../lib/imagePlacement'
import { PAGE_SIZES } from '../../../types/document'
import { DocumentPathContext } from '../DocumentPathContext'
import { reportError } from '../../../lib/errorLogging'

const ANCHOR_LABEL: Record<string, string> = {
  header: 'Header image',
  footer: 'Footer image',
  background: 'Background image',
}

/** Canvas rendering of an image node: resolves the stored path and applies the layout attributes. */
export function ImageView({ node, selected, updateAttributes, editor, getPos }: NodeViewProps) {
  const viewMode = useSettingsStore(state => state.viewMode)
  const zoom = useSettingsStore(state => state.zoom)
  const activePath = useDocumentStore((s) => s.document.path)
  const panePath = useContext(DocumentPathContext)
  const documentPath = panePath === undefined ? activePath : panePath
  const { src, alt, align, widthMm, frame, opacity, anchor, xMm, yMm } = node.attrs
  const [shown, setShown] = useState<{ src: string; url: string } | null>(null)
  const [failure, setFailure] = useState<{ src: string; message: string } | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const stopDrag = useRef<(() => void) | null>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const [corner, setCorner] = useState<{ left: number; top: number } | null>(null)

  const placeHandle = () => {
    const image = imageRef.current
    const page = image?.closest('.grimoire-page')
    if (!image || !page) return
    const rect = image.getBoundingClientRect()
    if (!rect.width) return
    // Viewport pixels: the handle lives outside the page, so it can never alter the page layout.
    const next = { left: rect.left + rect.width, top: rect.top + rect.height }
    // Sub-pixel noise must not re-render.
    setCorner((old) => old && Math.abs(old.left - next.left) < 0.3 && Math.abs(old.top - next.top) < 0.3 ? old : next)
  }

  useLayoutEffect(() => {
    if (!selected) return
    placeHandle()
    const image = imageRef.current
    const page = image?.closest('.grimoire-page')
    if (!image || !page || typeof ResizeObserver === 'undefined') return
    // Only the image: the page also resizes because of the handle itself (it is absolute inside a
    // spread's fragmented stack), which made the handle and the page chase each other forever.
    const observer = new ResizeObserver(placeHandle)
    observer.observe(image)
    // The handle is fixed to the viewport, so it follows scrolling and window changes itself.
    window.addEventListener('scroll', placeHandle, true)
    window.addEventListener('resize', placeHandle)
    return () => {
      observer.disconnect()
      window.removeEventListener('scroll', placeHandle, true)
      window.removeEventListener('resize', placeHandle)
    }
  }, [selected, shown, widthMm, anchor, align, xMm, yMm, viewMode, zoom])

  useEffect(() => () => stopDrag.current?.(), [])

  const startDrag = (event: ReactPointerEvent<HTMLImageElement>) => {
    if (event.button !== 0) return
    const image = event.currentTarget
    const page = image.closest('.grimoire-page')
    if (!page) return
    const pageRect = editorSheetRect(page, image)
    const imageRect = image.getBoundingClientRect()
    const freeBox = image.closest('.grimoire-content-box[data-placement="free"]')
    const origin = freeBox?.getBoundingClientRect() ?? editorStackOrigin(page, image)
    const spreadPair = !freeBox ? editorSpreadPair(page, image) : null
    if (!pageRect.width || !imageRect.width) return
    // Own this gesture before the browser generates a text-selection/native drag.
    event.preventDefault()
    event.stopPropagation()
    stopDrag.current?.()
    const nodePosition = getPos()
    if (typeof nodePosition === 'number') editor.commands.setNodeSelection(nodePosition)
    image.setPointerCapture?.(event.pointerId)
    const { widthMm: pageWidthMm, heightMm: pageHeightMm } = PAGE_SIZES[useSettingsStore.getState().pageSize]
    const startX = event.clientX
    const startY = event.clientY
    const pointerId = event.pointerId
    const originalStyle = { position: image.style.position, left: image.style.left, top: image.style.top, width: image.style.width, margin: image.style.margin }
    const renderedWidthMm = imageRect.width * pageWidthMm / pageRect.width
    const renderedHeightMm = imageRect.height * pageWidthMm / pageRect.width
    let moved = false
    let position: ReturnType<typeof positionImageOnPage> = null

    const cleanup = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', cancel)
      image.removeEventListener('lostpointercapture', cancel)
      if (image.hasPointerCapture?.(pointerId)) image.releasePointerCapture(pointerId)
      image.style.position = originalStyle.position
      image.style.left = originalStyle.left
      image.style.top = originalStyle.top
      image.style.width = originalStyle.width
      image.style.margin = originalStyle.margin
      placeHandle()
      stopDrag.current = null
    }
    const move = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) return
      const deltaX = next.clientX - startX
      const deltaY = next.clientY - startY
      if (!moved && Math.hypot(deltaX, deltaY) < 3) return
      if (spreadPair) {
        position = positionImageInSpread(spreadPair, imageRect, pageWidthMm, pageHeightMm, deltaX, deltaY)
      } else {
        position = positionImageOnPage(pageRect, imageRect, pageWidthMm, pageHeightMm, deltaX, deltaY)
        if (position) {
          // An absolute group is the containing block, while page bounds still define scale and limits.
          const scale = pageWidthMm / pageRect.width
          position = {
            xMm: Math.round(Math.max(0, position.xMm - (origin.left - pageRect.left) * scale) * 100) / 100,
            yMm: Math.round(Math.max(0, position.yMm - (origin.top - pageRect.top) * scale) * 100) / 100,
          }
        }
      }
      if (!position) return
      moved = true
      image.style.position = 'absolute'
      image.style.left = `${position.xMm}mm`
      image.style.top = `${position.yMm}mm`
      image.style.width = `${renderedWidthMm}mm`
      image.style.margin = '0'
      placeHandle()
      next.preventDefault()
    }
    const finish = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) return
      cleanup()
      if (!moved || !position) return
      const from = getPos()
      const current = typeof from === 'number' ? editor.state.doc.nodeAt(from) : null
      if (current?.type.name === 'image' && current.attrs.anchor === 'flow' && typeof from === 'number') {
        const marginMm = useSettingsStore.getState().marginMm
        const outsideMargin = !freeBox && isOutsideContentMargin(
          position,
          renderedWidthMm,
          renderedHeightMm,
          pageWidthMm,
          pageHeightMm,
          marginMm,
        )
        let hit: ReturnType<typeof editor.view.posAtCoords> = null
        try {
          hit = editor.view.posAtCoords({ left: next.clientX, top: next.clientY })
        } catch {
          hit = null
        }
        if (!hit) {
          if (outsideMargin) {
            updateAttributes({ anchor: 'free', align: 'none', xMm: position.xMm, yMm: position.yMm, widthMm: renderedWidthMm })
          }
          return
        }
        let destination = dropPoint(editor.state.doc, hit.pos, new Slice(Fragment.from(current), 0, 0))
        let movedImage = current
        let wrappedColumn = false
        const resolved = editor.state.doc.resolve(hit.pos)
        const paragraphPosition = resolved.parent.type.name === 'paragraph' ? resolved.before()
          : resolved.nodeAfter?.type.name === 'paragraph' ? hit.pos
            : resolved.nodeBefore?.type.name === 'paragraph' ? hit.pos - resolved.nodeBefore.nodeSize : null
        const paragraph = paragraphPosition === null ? null : editor.view.nodeDOM(paragraphPosition)
        if (paragraph instanceof HTMLElement) {
          // Use the fragment under the pointer, not the union of both page columns.
          const fragments = Array.from(paragraph.getClientRects()).filter((rect) => rect.width > 0)
          const column = fragments.find((rect) => next.clientX >= rect.left && next.clientX <= rect.right
            && next.clientY >= rect.top && next.clientY <= rect.bottom)
          if (column) {
            wrappedColumn = true
            destination = paragraphPosition
            const align = next.clientX < column.left + column.width / 2 ? 'left' : 'right'
            const widthMm = Math.round(Math.min(renderedWidthMm, column.width * pageWidthMm / pageRect.width * 0.45) * 100) / 100
            movedImage = current.type.create({ ...current.attrs, align, widthMm, xMm: null, yMm: null }, null, current.marks)
          }
        }
        if (!wrappedColumn && outsideMargin) {
          updateAttributes({ anchor: 'free', align: 'none', xMm: position.xMm, yMm: position.yMm, widthMm: renderedWidthMm })
          return
        }
        // Already beside this paragraph: change sides without deleting/reinserting it.
        if (destination === from + current.nodeSize && movedImage !== current) {
          editor.view.dispatch(editor.state.tr.setNodeMarkup(from, undefined, movedImage.attrs))
          return
        }
        if (destination === null || (destination >= from && destination <= from + current.nodeSize)) return
        const transaction = editor.state.tr.delete(from, from + current.nodeSize)
        const insertion = transaction.mapping.map(destination)
        transaction.insert(insertion, movedImage)
        transaction.setSelection(NodeSelection.create(transaction.doc, insertion))
        editor.view.dispatch(transaction)
      } else if (current?.type.name === 'image') {
        updateAttributes({ anchor: 'free', align: 'none', xMm: position.xMm, yMm: position.yMm, widthMm: renderedWidthMm })
      }
    }
    const cancel = (next: PointerEvent) => {
      if (next.pointerId === pointerId) cleanup()
    }
    stopDrag.current = cleanup
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', cancel)
    image.addEventListener('lostpointercapture', cancel)
  }

  const startResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    const image = imageRef.current
    const page = image?.closest<HTMLElement>('.grimoire-page')
    if (!image || !page) return
    const pageRect = editorSheetRect(page, image)
    const spreadPair = anchor === 'free' ? editorSpreadPair(page, image) : null
    const rect = image.getBoundingClientRect()
    if (!pageRect.width || !rect.width || !rect.height) return
    event.preventDefault()
    event.stopPropagation()
    stopDrag.current?.()
    const handle = event.currentTarget
    const pointerId = event.pointerId
    handle.setPointerCapture?.(pointerId)
    const startX = event.clientX
    const startY = event.clientY
    const originalWidth = image.style.width
    const pageSize = PAGE_SIZES[useSettingsStore.getState().pageSize]
    const mmPerPx = pageSize.widthMm / pageRect.width
    const ratio = rect.height / rect.width
    const startWidth = rect.width * mmPerPx
    const wrapper = image.parentElement
    let flowWidth = wrapper?.getBoundingClientRect().width || pageRect.width
    if (anchor === 'flow' && (align === 'left' || align === 'right') && wrapper?.parentElement) {
      // Floats shrink around their image. Measure the containing column fragment,
      // not that shrink-to-fit wrapper or the union of both columns.
      const container = wrapper.parentElement
      const fragments = Array.from(container.getClientRects()).filter(fragment => fragment.width > 0)
      const center = rect.left + rect.width / 2
      const column = fragments.find(fragment => center >= fragment.left && center <= fragment.right
        && rect.top < fragment.bottom && rect.bottom > fragment.top)
        ?? fragments.find(fragment => center >= fragment.left && center <= fragment.right)
      if (column) {
        const blockStyle = getComputedStyle(container)
        const floatStyle = getComputedStyle(wrapper)
        const spacing = [blockStyle.paddingLeft, blockStyle.paddingRight, blockStyle.borderLeftWidth,
          blockStyle.borderRightWidth, floatStyle.marginLeft, floatStyle.marginRight]
          .reduce((sum, value) => sum + (parseFloat(value) || 0), 0)
        const scale = pageRect.width / (page.offsetWidth || pageRect.width)
        flowWidth = Math.max(0, column.width - spacing * scale)
      }
    }
    const maxSheetWidthMm = spreadPair?.right ? 2 * pageSize.widthMm : pageSize.widthMm
    const sheetLeftPx = spreadPair?.right ? spreadPair.left.left : pageRect.left
    const sheetTopPx = spreadPair?.right ? spreadPair.left.top : pageRect.top
    const available = anchor === 'free'
      ? Math.min(maxSheetWidthMm - (rect.left - sheetLeftPx) * mmPerPx,
        (pageSize.heightMm - (rect.top - sheetTopPx) * mmPerPx) / ratio)
      : flowWidth * mmPerPx
    const maximum = Math.max(5, Math.min(500, available))
    let nextWidth = startWidth
    let moved = false
    const cleanup = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', cancel)
      handle.removeEventListener('lostpointercapture', cancel)
      if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId)
      image.style.width = originalWidth
      stopDrag.current = null
      placeHandle()
    }
    const move = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) return
      const dx = next.clientX - startX
      const dy = next.clientY - startY
      if (!moved && Math.hypot(dx, dy) < 3) return
      moved = true
      // Project the corner movement onto the image's original aspect ratio.
      const delta = (dx + dy * ratio) / (1 + ratio * ratio) * mmPerPx
      nextWidth = Math.round(Math.max(5, Math.min(maximum, startWidth + delta)) * 100) / 100
      image.style.width = `${nextWidth}mm`
      placeHandle()
      next.preventDefault()
    }
    const finish = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) return
      cleanup()
      // One transaction per gesture keeps resizing a single undoable operation.
      if (moved) updateAttributes({ widthMm: nextWidth })
    }
    const cancel = (next: PointerEvent) => { if (next.pointerId === pointerId) cleanup() }
    stopDrag.current = cleanup
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', cancel)
    handle.addEventListener('lostpointercapture', cancel)
  }

  useEffect(() => {
    let cancelled = false
    let created: string | null = null
    setShown(null)
    setFailure(null)
    const timer = window.setTimeout(() => {
      cancelled = true
      const message = `Image loading timed out: ${src}`
      reportError('editor.image.load', new Error(message))
      setFailure({ src, message })
    }, 15000)
    loadImageUrl(src, documentPath).then(
      (url) => {
        if (cancelled) return revokeImageUrl(url)
        window.clearTimeout(timer)
        created = url
        setShown({ src, url })
        setFailure(null)
      },
      (e: unknown) => {
        window.clearTimeout(timer)
        if (!cancelled) { reportError('editor.image.load', e); setFailure({ src, message: e instanceof Error ? e.message : String(e) }) }
      },
    )
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      if (created) revokeImageUrl(created)
    }
  }, [src, documentPath, loadAttempt])

  const url = shown && shown.src === src ? shown.url : null
  const error = failure && failure.src === src ? failure.message : null
  const imageStyle: CSSProperties = {
    width: widthMm === null ? undefined : `${widthMm}mm`,
    opacity,
    left: anchor === 'free' ? `${xMm ?? 0}mm` : undefined,
    top: anchor === 'free' ? `${yMm ?? 0}mm` : undefined,
  }

  return (
    <NodeViewWrapper
      className="grimoire-image"
      data-align={align}
      data-anchor={anchor}
      data-frame={frame}
      data-selected={selected}
    >
      {anchor !== 'flow' && anchor !== 'free' && (
        <span className="grimoire-image-chip" contentEditable={false}>
          {ANCHOR_LABEL[anchor] ?? 'Image'} · {String(src).split('/').pop()}
        </span>
      )}
      {url && !error ? (
        <img
          ref={imageRef}
          src={url}
          alt={alt ?? ''}
          draggable={false}
          data-x-mm={anchor === 'free' ? (xMm ?? 0) : undefined}
          data-y-mm={anchor === 'free' ? (yMm ?? 0) : undefined}
          data-width-mm={widthMm ?? undefined}
          style={imageStyle}
          onPointerDown={startDrag}
          onLoad={placeHandle}
          onError={() => setFailure({ src, message: `Unable to decode image: ${src}` })}
          onDragStart={(event) => { event.preventDefault(); event.stopPropagation() }}
        />
      ) : (
        <span className="grimoire-image-chip" contentEditable={false}>
          {error ? <><span role="alert">{error}</span>{' '}<button type="button"
            onClick={() => setLoadAttempt(value => value + 1)}>Retry image</button></> : 'Loading image…'}
        </span>
      )}
      {url && selected && corner && (anchor === 'flow' || anchor === 'free') && createPortal(
        <button type="button" contentEditable={false} className="grimoire-image-resize"
          aria-label="Resize image" title="Drag to resize proportionally; arrow keys adjust width"
          style={{ position: 'fixed', left: `${corner.left}px`, top: `${corner.top}px`, zIndex: 20 }}
          onPointerDown={startResize}
          onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
            event.preventDefault()
            event.stopPropagation()
            const delta = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1
            const image = imageRef.current
            const pageElement = image?.closest('.grimoire-page')
            const page = image && pageElement ? editorSheetRect(pageElement, image) : undefined
            const current = widthMm ?? (image && page?.width ? image.getBoundingClientRect().width * PAGE_SIZES[useSettingsStore.getState().pageSize].widthMm / page.width : 40)
            updateAttributes({ widthMm: Math.min(500, Math.max(5, current + delta)) })
          }} />,
        document.body,
      )}
    </NodeViewWrapper>
  )
}
