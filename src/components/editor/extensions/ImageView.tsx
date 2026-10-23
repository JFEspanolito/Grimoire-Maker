import { useContext, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { useDocumentStore } from '../../../stores/documentStore'
import { useSettingsStore } from '../../../stores/settingsStore'
import { loadImageUrl, revokeImageUrl } from '../../../lib/images'
import { positionImageOnPage } from '../../../lib/imagePlacement'
import { PAGE_SIZES } from '../../../types/document'
import { DocumentPathContext } from '../DocumentPathContext'

const ANCHOR_LABEL: Record<string, string> = {
  header: 'Header image',
  footer: 'Footer image',
  background: 'Background image',
}

/** Canvas rendering of an image node: resolves the stored path and applies the layout attributes. */
export function ImageView({ node, selected, updateAttributes }: NodeViewProps) {
  const activePath = useDocumentStore((s) => s.document.path)
  const panePath = useContext(DocumentPathContext)
  const documentPath = panePath === undefined ? activePath : panePath
  const { src, alt, align, widthMm, frame, opacity, anchor, xMm, yMm } = node.attrs
  const [shown, setShown] = useState<{ src: string; url: string } | null>(null)
  const [failure, setFailure] = useState<{ src: string; message: string } | null>(null)
  const stopDrag = useRef<(() => void) | null>(null)

  useEffect(() => () => stopDrag.current?.(), [])

  const startDrag = (event: ReactPointerEvent<HTMLImageElement>) => {
    if (event.button !== 0) return
    const image = event.currentTarget
    const page = image.closest('.grimoire-page')
    if (!page) return
    const pageRect = page.getBoundingClientRect()
    const imageRect = image.getBoundingClientRect()
    if (!pageRect.width || !imageRect.width) return
    const { widthMm: pageWidthMm, heightMm: pageHeightMm } = PAGE_SIZES[useSettingsStore.getState().pageSize]
    const startX = event.clientX
    const startY = event.clientY
    const pointerId = event.pointerId
    const originalStyle = { position: image.style.position, left: image.style.left, top: image.style.top }
    let moved = false
    let position: ReturnType<typeof positionImageOnPage> = null

    const cleanup = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', cancel)
      image.style.position = originalStyle.position
      image.style.left = originalStyle.left
      image.style.top = originalStyle.top
      stopDrag.current = null
    }
    const move = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) return
      const deltaX = next.clientX - startX
      const deltaY = next.clientY - startY
      if (!moved && Math.hypot(deltaX, deltaY) < 3) return
      position = positionImageOnPage(pageRect, imageRect, pageWidthMm, pageHeightMm, deltaX, deltaY)
      if (!position) return
      moved = true
      image.style.position = 'absolute'
      image.style.left = `${position.xMm}mm`
      image.style.top = `${position.yMm}mm`
      next.preventDefault()
    }
    const finish = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) return
      cleanup()
      if (moved && position) updateAttributes({ anchor: 'free', xMm: position.xMm, yMm: position.yMm })
    }
    const cancel = (next: PointerEvent) => {
      if (next.pointerId === pointerId) cleanup()
    }
    stopDrag.current?.()
    stopDrag.current = cleanup
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', cancel)
  }

  useEffect(() => {
    let cancelled = false
    let created: string | null = null
    loadImageUrl(src, documentPath).then(
      (url) => {
        if (cancelled) return revokeImageUrl(url)
        created = url
        setShown({ src, url })
        setFailure(null)
      },
      (e: unknown) => {
        if (!cancelled) setFailure({ src, message: e instanceof Error ? e.message : String(e) })
      },
    )
    return () => {
      cancelled = true
      if (created) revokeImageUrl(created)
    }
  }, [src, documentPath])

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
      {url ? (
        <img
          src={url}
          alt={alt ?? ''}
          draggable={false}
          style={imageStyle}
          onPointerDown={startDrag}
        />
      ) : (
        <span className="grimoire-image-chip" contentEditable={false}>
          {error ? `Image not found: ${src}` : 'Loading image…'}
        </span>
      )}
    </NodeViewWrapper>
  )
}
