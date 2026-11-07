import { create } from 'zustand'
import type { Editor } from '@tiptap/react'

export interface CopiedFormat {
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  color: string | null
  fontSize: string | null
  fontFamily: string | null
  textAlign: string | null
}

interface FormatPainterState {
  armed: boolean
  format: CopiedFormat | null
  arm: (editor: Editor) => void
  disarm: () => void
  apply: (editor: Editor) => boolean
}

export function captureFormat(editor: Editor): CopiedFormat {
  const textStyle = (editor.getAttributes('textStyle') || {}) as { color?: string; fontSize?: string; fontFamily?: string }
  const block = editor.isActive('heading') ? 'heading' : 'paragraph'
  const align = (editor.getAttributes(block) as { textAlign?: string }).textAlign
  return {
    bold: editor.isActive('bold'),
    italic: editor.isActive('italic'),
    underline: editor.isActive('underline'),
    strike: editor.isActive('strike'),
    color: textStyle.color || null,
    fontSize: textStyle.fontSize || null,
    fontFamily: textStyle.fontFamily || null,
    textAlign: align && align !== 'left' ? align : null,
  }
}

export function applyCopiedFormat(editor: Editor, format: CopiedFormat) {
  const chain = editor.chain().focus()

  if (format.bold) chain.setBold(); else chain.unsetBold()
  if (format.italic) chain.setItalic(); else chain.unsetItalic()
  if (format.underline) chain.setUnderline(); else chain.unsetUnderline()
  if (format.strike) chain.setStrike(); else chain.unsetStrike()

  if (format.color) chain.setColor(format.color); else chain.unsetColor()
  if (format.fontSize) chain.setFontSize(format.fontSize); else chain.unsetFontSize()
  if (format.fontFamily) chain.setFontFamily(format.fontFamily); else chain.unsetFontFamily()

  if (format.textAlign) chain.setTextAlign(format.textAlign)

  chain.run()
}

export const useFormatPainterStore = create<FormatPainterState>((set, get) => ({
  armed: false,
  format: null,
  arm: (editor) => {
    const { armed } = get()
    if (armed) {
      set({ armed: false, format: null })
      return
    }
    const format = captureFormat(editor)
    set({ armed: true, format })
  },
  disarm: () => set({ armed: false, format: null }),
  apply: (editor) => {
    const { armed, format } = get()
    if (!armed || !format) return false
    const { from, to } = editor.state.selection
    if (from === to) {
      const $pos = editor.state.doc.resolve(from)
      const parent = $pos.parent
      if (parent.isTextblock && parent.textContent.trim().length > 0) {
        const text = parent.textContent
        const offset = $pos.parentOffset
        let start = offset
        let end = offset
        while (start > 0 && /\S/.test(text[start - 1])) start--
        while (end < text.length && /\S/.test(text[end])) end++
        if (start < end) {
          const basePos = $pos.start()
          editor.commands.setTextSelection({ from: basePos + start, to: basePos + end })
        }
      }
    }
    applyCopiedFormat(editor, format)
    set({ armed: false, format: null })
    return true
  },
}))
