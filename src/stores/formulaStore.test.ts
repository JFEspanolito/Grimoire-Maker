import type { Editor } from '@tiptap/react'
import { beforeEach, expect, it } from 'vitest'
import { DEFAULT_FORMULA_LATEX, useFormulaStore } from './formulaStore'
const initial = useFormulaStore.getState()
beforeEach(() => useFormulaStore.setState(initial))
const selected = { state: { selection: { from: 12, node: { type: { name: 'mathFormula' }, attrs: { latex: 'a+b', display: 'inline' } } } } } as unknown as Editor

it('edits the selected formula in place and releases its editor when closed', () => {
  useFormulaStore.getState().show(selected)
  expect(useFormulaStore.getState()).toMatchObject({ open: true, editor: selected, latex: 'a+b', display: 'inline', editPos: 12 })
  useFormulaStore.getState().hide()
  expect(useFormulaStore.getState()).toMatchObject({ open: false, editor: null, editPos: null })
})

it('explicit insertion options override a selected formula rather than editing that node', () => {
  useFormulaStore.getState().show(selected, { latex: 'x^2' })
  expect(useFormulaStore.getState()).toMatchObject({ latex: 'x^2', display: 'block', editPos: null })
  useFormulaStore.getState().show({ state: { selection: { from: 1 } } } as unknown as Editor)
  expect(useFormulaStore.getState()).toMatchObject({ latex: DEFAULT_FORMULA_LATEX, editPos: null })
})
