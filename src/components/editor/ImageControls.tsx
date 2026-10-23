import type { Editor } from '@tiptap/react'
import type { ImageAlign, ImageAnchor, ImageFrame } from './extensions/image'

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
  ['flow', 'In text'],
  ['header', 'Page header'],
  ['footer', 'Page footer'],
  ['background', 'Page background'],
  ['free', 'Free position'],
]

const field = 'flex items-center gap-1 text-xs text-white/60'
const control = 'rounded bg-white/10 px-1 py-0.5 text-sm text-white'

/** Layout controls for the selected image: wrap, size, frame, opacity and page anchor. */
export function ImageControls({ editor, attrs }: { editor: Editor; attrs: ImageAttrs }) {
  // No `focus()`: moving focus into the editor would interrupt typing in these inputs.
  const update = (patch: Partial<ImageAttrs>) => editor.commands.updateAttributes('image', patch)

  return (
    <div
      role="group"
      aria-label="Image layout"
      className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-white/10 bg-neutral-900 px-3 py-1"
    >
      <label className={field}>
        Wrap
        <select
          className={control}
          value={attrs.align}
          onChange={(e) => update({ align: e.target.value as ImageAlign })}
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
        Anchor
        <select
          className={control}
          value={attrs.anchor}
          onChange={(e) => update({ anchor: e.target.value as ImageAnchor })}
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
