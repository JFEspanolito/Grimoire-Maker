import { describe, it, expect, beforeEach } from 'vitest'
import { Editor } from '@tiptap/react'
import { EDITOR_EXTENSIONS } from '../components/editor/editorExtensions'
import { useFormatPainterStore } from './formatPainterStore'

describe('formatPainterStore', () => {
  beforeEach(() => {
    useFormatPainterStore.getState().disarm()
  })

  it('arms and disarms format painter', () => {
    const editor = new Editor({
      extensions: EDITOR_EXTENSIONS,
      content: '<p><strong>Bold text</strong></p>',
    })
    editor.commands.setTextSelection(3)

    expect(useFormatPainterStore.getState().armed).toBe(false)
    useFormatPainterStore.getState().arm(editor)
    expect(useFormatPainterStore.getState().armed).toBe(true)
    expect(useFormatPainterStore.getState().format?.bold).toBe(true)

    // Toggle off by arming again
    useFormatPainterStore.getState().arm(editor)
    expect(useFormatPainterStore.getState().armed).toBe(false)
  })

  it('applies copied format to target text and disarms', () => {
    const editor = new Editor({
      extensions: EDITOR_EXTENSIONS,
      content: '<p><strong><span style="color: #00ff00; font-size: 18px">Styled</span></strong></p><p>Plain</p>',
    })

    let styledPos = -1
    let plainPos = -1
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === 'Styled') styledPos = pos
      if (node.isText && node.text === 'Plain') plainPos = pos
    })

    editor.commands.setTextSelection({ from: styledPos, to: styledPos + 6 })
    useFormatPainterStore.getState().arm(editor)

    editor.commands.setTextSelection({ from: plainPos, to: plainPos + 5 })
    const applied = useFormatPainterStore.getState().apply(editor)
    expect(applied).toBe(true)
    expect(useFormatPainterStore.getState().armed).toBe(false)

    editor.commands.setTextSelection(plainPos + 1)
    expect(editor.isActive('bold')).toBe(true)
    expect(editor.getAttributes('textStyle').color).toBe('#00ff00')
    expect(editor.getAttributes('textStyle').fontSize).toBe('18px')
  })
})
