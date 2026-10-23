import type { Editor } from '@tiptap/react'
import { NodeSelection } from '@tiptap/pm/state'
import type { ImageAlign, ImageAnchor, ImageFrame } from './extensions/image'
import { useSettingsStore } from '../../stores/settingsStore'
import { PAGE_SIZES } from '../../types/document'
import { positionImageOnPage } from '../../lib/imagePlacement'

export interface ImageAttrs {
  alt: string | null
  align: ImageAlign
  widthMm: number | null
  frame: ImageFrame
  opacity: number
  anchor: ImageAnchor
  xMm: number | null
  yMm: number | null
}

const ALIGNS: [ImageAlign, string][] = [
  ['none', 'In line'],
  ['left', 'Wrap · left'],
  ['center', 'Centered'],
  ['right', 'Wrap · right'],
]

const FRAMES: [ImageFrame, string][] = [
  ['none', 'No frame'],
  ['simple', 'Simple'],
  ['double', 'Double'],
  ['shadow', 'Shadow'],
]

const ANCHORS: [ImageAnchor, string][] = [
  ['flow', 'Push text'],
  ['free', 'Over text'],
  ['header', 'Page header'],
  ['footer', 'Page footer'],
  ['background', 'Page background'],
]

const field = 'flex items-center gap-1 text-xs text-white/60'
const control = 'rounded bg-white/10 px-1 py-0.5 text-sm text-white'

const EMPTY_IMAGE: ImageAttrs = {
  alt: '', align: 'none', widthMm: null, frame: 'none', opacity: 1, anchor: 'flow', xMm: null, yMm: null,
}

/** Layout controls for the selected image: wrap, size, frame, opacity and page anchor. */
export function ImageControls({ editor, attrs: selection }: { editor: Editor | null; attrs: ImageAttrs | null }) {
  const active = !!editor && !!selection
  const attrs = selection ?? EMPTY_IMAGE
  // No `focus()`: moving focus into the editor would interrupt typing in these inputs.
  const update = (patch: Partial<ImageAttrs>) => { if (active) editor.commands.updateAttributes('image', patch) }
  const setWrapping = (align: ImageAlign) => {
    if (!editor || !selection) return
    const patch = { align, anchor: 'flow' as const, xMm: null, yMm: null }
    const selected = editor.state.selection
    if ((align === 'left' || align === 'right') && selected instanceof NodeSelection && selected.node.type.name === 'image'
      && !['left', 'right'].includes(selected.node.attrs.align)) {
      const previous = selected.$from.nodeBefore
      // Floats wrap following text, never the paragraph that precedes the image.
      // Keep both as normal Markdown blocks, placing the float before its paragraph.
      if (previous?.type.name === 'paragraph') {
        const beforeParagraph = selected.from - previous.nodeSize
        const image = selected.node.type.create({ ...selected.node.attrs, ...patch }, null, selected.node.marks)
        const transaction = editor.state.tr.delete(selected.from, selected.to).insert(beforeParagraph, image)
        transaction.setSelection(NodeSelection.create(transaction.doc, beforeParagraph))
        editor.view.dispatch(transaction)
        return
      }
    }
    update(patch)
  }
  const setPlacement = (anchor: ImageAnchor) => {
    if (!editor || !selection) return
    if (anchor === 'flow') {
      update({ anchor, xMm: null, yMm: null })
      return
    }
    if (anchor === 'free') {
      const node = editor.view.nodeDOM(editor.state.selection.from)
      const image = node instanceof HTMLElement ? (node.matches('img') ? node : node.querySelector('img')) : null
      const page = image?.closest('.grimoire-page')?.getBoundingClientRect()
      const rect = image?.getBoundingClientRect()
      const size = PAGE_SIZES[useSettingsStore.getState().pageSize]
      const position = page && rect ? positionImageOnPage(page, rect, size.widthMm, size.heightMm, 0, 0) : null
      update({ anchor, align: 'none', xMm: position?.xMm ?? attrs.xMm ?? 0, yMm: position?.yMm ?? attrs.yMm ?? 0,
        widthMm: page?.width && rect?.width ? rect.width * size.widthMm / page.width : attrs.widthMm })
      return
    }
    update({ anchor })
  }

  return (
    <div
      role="group"
      aria-label="Image layout"
      aria-hidden={!active}
      inert={!active}
      className={`flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-white/10 bg-neutral-900 px-3 py-1 ${active ? '' : '[&>label]:invisible'}`}
    >
      <label className={field}>
        Wrap
        <select
          aria-label="Text wrapping"
          title="Wrap right places the image to the right of its paragraph, with text on the left. Wrap left does the opposite."
          className={control}
          value={attrs.align}
          onChange={(e) => setWrapping(e.target.value as ImageAlign)}
        >
          {ALIGNS.map(([value, label]) => (
            <option key={value} value={value} className="text-black">
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className={field}>
        Width (mm)
        <input
          type="number"
          min={5}
          max={500}
          step={1}
          placeholder="auto"
          className={`${control} w-16`}
          value={attrs.widthMm ?? ''}
          onChange={(e) => {
            const mm = e.target.valueAsNumber
            update({ widthMm: Number.isFinite(mm) && mm > 0 ? mm : null })
          }}
        />
      </label>
      <label className={field}>
        Frame
        <select
          className={control}
          value={attrs.frame}
          onChange={(e) => update({ frame: e.target.value as ImageFrame })}
        >
          {FRAMES.map(([value, label]) => (
            <option key={value} value={value} className="text-black">
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className={field}>
        Opacity
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.05}
          value={attrs.opacity}
          onChange={(e) => update({ opacity: Number(e.target.value) })}
        />
        <span className="w-8 tabular-nums">{Math.round(attrs.opacity * 100)}%</span>
      </label>
      <label className={field}>
        Text placement
        <select
          aria-label="Text placement"
          title="Over text allows free positioning. In Push text, drop beside a paragraph to wrap on its left or right without covering the text."
          className={control}
          value={attrs.anchor}
          onChange={(e) => setPlacement(e.target.value as ImageAnchor)}
        >
          {ANCHORS.map(([value, label]) => (
            <option key={value} value={value} className="text-black">
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className={field}>
        Alt text
        <input
          type="text"
          className={`${control} w-40`}
          value={attrs.alt ?? ''}
          onChange={(e) => update({ alt: e.target.value })}
        />
      </label>
    </div>
  )
}
