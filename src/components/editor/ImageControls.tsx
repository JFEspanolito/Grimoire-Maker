import type { Editor } from '@tiptap/react'
import { NodeSelection } from '@tiptap/pm/state'
import type { ImageAlign, ImageAnchor, ImageFrame } from './extensions/image'
import { useSettingsStore } from '../../stores/settingsStore'
import { PAGE_SIZES } from '../../types/document'
import { positionImageOnPage } from '../../lib/imagePlacement'
import { useTranslation, type TranslationKey } from '../../lib/i18n'

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

const ALIGN_KEYS: [ImageAlign, TranslationKey][] = [
  ['none', 'image.wrapInline'],
  ['left', 'image.wrapLeft'],
  ['center', 'image.wrapCenter'],
  ['right', 'image.wrapRight'],
]

const FRAME_KEYS: [ImageFrame, TranslationKey][] = [
  ['none', 'image.frameNone'],
  ['simple', 'image.frameSimple'],
  ['double', 'image.frameDouble'],
  ['shadow', 'image.frameShadow'],
]

const ANCHOR_KEYS: [ImageAnchor, TranslationKey][] = [
  ['flow', 'image.placementFlow'],
  ['free', 'image.placementFree'],
  ['header', 'image.placementHeader'],
  ['footer', 'image.placementFooter'],
  ['background', 'image.placementBackground'],
]

const field = 'flex items-center gap-1 text-xs text-white/60'
const control = 'rounded bg-white/10 px-1 py-0.5 text-sm text-white'

const EMPTY_IMAGE: ImageAttrs = {
  alt: '', align: 'none', widthMm: null, frame: 'none', opacity: 1, anchor: 'flow', xMm: null, yMm: null,
}

/** Layout controls for the selected image: wrap, size, frame, opacity and page anchor. */
export function ImageControls({ editor, attrs: selection }: { editor: Editor | null; attrs: ImageAttrs | null }) {
  const { t } = useTranslation()
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
      aria-label={t('image.layout')}
      aria-hidden={!active}
      inert={!active}
      className={`flex min-h-9 shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-white/10 bg-neutral-900 px-3 py-1 ${active ? '' : '[&>label]:invisible'}`}
    >
      <label className={field}>
        {t('image.wrap')}
        <select
          aria-label={t('image.textWrapping')}
          title={t('image.wrapTooltip')}
          className={control}
          value={attrs.align}
          onChange={(e) => setWrapping(e.target.value as ImageAlign)}
        >
          {ALIGN_KEYS.map(([value, labelKey]) => (
            <option key={value} value={value} className="text-black">
              {t(labelKey)}
            </option>
          ))}
        </select>
      </label>
      <label className={field}>
        {t('image.width')}
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
        {t('image.frame')}
        <select
          className={control}
          value={attrs.frame}
          onChange={(e) => update({ frame: e.target.value as ImageFrame })}
        >
          {FRAME_KEYS.map(([value, labelKey]) => (
            <option key={value} value={value} className="text-black">
              {t(labelKey)}
            </option>
          ))}
        </select>
      </label>
      <label className={field}>
        {t('image.opacity')}
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
        {t('image.placement')}
        <select
          aria-label={t('image.placement')}
          title={t('image.placementTooltip')}
          className={control}
          value={attrs.anchor}
          onChange={(e) => setPlacement(e.target.value as ImageAnchor)}
        >
          {ANCHOR_KEYS.map(([value, labelKey]) => (
            <option key={value} value={value} className="text-black">
              {t(labelKey)}
            </option>
          ))}
        </select>
      </label>
      <label className={field}>
        {t('image.altText')}
        <input
          type="text"
          className={`${control} w-40`}
          value={attrs.alt ?? ''}
          onChange={(e) => update({ alt: e.target.value })}
        />
      </label>
      {active && (
        <button
          type="button"
          className="ml-auto rounded px-2 py-1 text-xs text-red-400 hover:bg-white/10"
          title={t('image.delete')}
          aria-label={t('image.delete')}
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => {
            if (editor) {
              editor.chain().focus().deleteSelection().run()
            }
          }}
        >
          {t('common.delete')}
        </button>
      )}
    </div>
  )
}
