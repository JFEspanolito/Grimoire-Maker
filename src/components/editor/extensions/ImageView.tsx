import { useEffect, useState } from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { useDocumentStore } from '../../../stores/documentStore'
import { loadImageUrl, revokeImageUrl } from '../../../lib/images'

const ANCHOR_LABEL: Record<string, string> = {
  header: 'Header image',
  footer: 'Footer image',
  background: 'Background image',
}

/** Canvas rendering of an image node: resolves the stored path and applies the layout attributes. */
export function ImageView({ node, selected }: NodeViewProps) {
  const documentPath = useDocumentStore((s) => s.document.path)
  const { src, alt, align, widthMm, frame, opacity, anchor } = node.attrs
  const [shown, setShown] = useState<{ src: string; url: string } | null>(null)
  const [failure, setFailure] = useState<{ src: string; message: string } | null>(null)

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

  return (
    <NodeViewWrapper
      className="grimoire-image"
      data-align={align}
      data-anchor={anchor}
      data-frame={frame}
      data-selected={selected}
    >
      {anchor !== 'flow' && (
        <span className="grimoire-image-chip" contentEditable={false}>
          {ANCHOR_LABEL[anchor] ?? 'Image'} · {String(src).split('/').pop()}
        </span>
      )}
      {url ? (
        <img
          src={url}
          alt={alt ?? ''}
          draggable={false}
          style={{ width: widthMm === null ? undefined : `${widthMm}mm`, opacity }}
        />
      ) : (
        <span className="grimoire-image-chip" contentEditable={false}>
          {error ? `Image not found: ${src}` : 'Loading image…'}
        </span>
      )}
    </NodeViewWrapper>
  )
}
