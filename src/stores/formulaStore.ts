import type { Editor } from '@tiptap/react'
import { create } from 'zustand'

export type FormulaDisplay = 'inline' | 'block'

interface FormulaDialogState {
  open: boolean
  editor: Editor | null
  latex: string
  display: FormulaDisplay
  /** Node position when editing an existing formula in the document; null when inserting a new one. */
  editPos: number | null
  show: (editor: Editor, options?: { latex?: string; display?: FormulaDisplay; editPos?: number | null }) => void
  hide: () => void
}

export const DEFAULT_FORMULA_LATEX = 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}'

export const useFormulaStore = create<FormulaDialogState>((set) => ({
  open: false,
  editor: null,
  latex: DEFAULT_FORMULA_LATEX,
  display: 'block',
  editPos: null,
  show: (editor, options) => {
    // If a mathFormula node is currently selected and no explicit options were passed, edit it in place.
    const selection = editor.state.selection as { node?: { type: { name: string }; attrs: { latex?: string; display?: FormulaDisplay } }; from: number }
    if (!options && selection.node?.type.name === 'mathFormula') {
      set({
        open: true,
        editor,
        latex: String(selection.node.attrs.latex ?? ''),
        display: selection.node.attrs.display === 'inline' ? 'inline' : 'block',
        editPos: selection.from,
      })
      return
    }
    set({
      open: true,
      editor,
      latex: options?.latex ?? DEFAULT_FORMULA_LATEX,
      display: options?.display ?? 'block',
      editPos: options?.editPos ?? null,
    })
  },
  hide: () => set({ open: false, editor: null, editPos: null }),
}))
