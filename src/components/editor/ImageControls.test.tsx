import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import { expect, it } from 'vitest'
import { GrimoireImage } from './extensions/image'
import { ImageControls, type ImageAttrs } from './ImageControls'

it('switches between over-text positioning and text-pushing flow without losing width', async () => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  const editor = new Editor({ extensions: [StarterKit, GrimoireImage],
    content: '<img src="map.png" data-anchor="free" data-width-mm="40" data-x-mm="30" data-y-mm="40" /><p>Text</p>' })
  editor.commands.setNodeSelection(0)
  const host = document.createElement('div')
  const root = createRoot(host)
  try {
    await act(async () => root.render(<ImageControls editor={editor} attrs={editor.getAttributes('image') as ImageAttrs} />))
    const placement = host.querySelector<HTMLSelectElement>('[aria-label="Text placement"]')
    expect(placement).not.toBeNull()
    expect(placement!.textContent).toContain('Over text')
    expect(placement!.textContent).toContain('Push text')
    await act(async () => { placement!.value = 'flow'; placement!.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(editor.getAttributes('image')).toMatchObject({ anchor: 'flow', align: 'none', widthMm: 40, xMm: null, yMm: null })
    await act(async () => { placement!.value = 'free'; placement!.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(editor.getAttributes('image')).toMatchObject({ anchor: 'free', widthMm: 40 })
    const wrap = host.querySelector<HTMLSelectElement>('[aria-label="Text wrapping"]')!
    await act(async () => { wrap.value = 'left'; wrap.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(editor.getAttributes('image')).toMatchObject({ anchor: 'flow', align: 'left', widthMm: 40 })
    expect(editor.getText()).toContain('Text')
  } finally { await act(async () => root.unmount()); editor.destroy() }
})

it.each(['left', 'right'])('wraps an image on the %s beside the preceding paragraph and preserves it on reload', async (align) => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  const editor = new Editor({ extensions: [StarterKit, GrimoireImage, Markdown.configure({ html: true })],
    content: '<p>Text beside image</p><img src="map.png" data-width-mm="30" /><p>More text</p>' })
  const imagePosition = editor.state.doc.firstChild!.nodeSize
  editor.commands.setNodeSelection(imagePosition)
  const host = document.createElement('div')
  const root = createRoot(host)
  try {
    await act(async () => root.render(<ImageControls editor={editor} attrs={editor.getAttributes('image') as ImageAttrs} />))
    const wrap = host.querySelector<HTMLSelectElement>('[aria-label="Text wrapping"]')!
    await act(async () => { wrap.value = align; wrap.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(editor.state.doc.firstChild?.type.name).toBe('image')
    expect(editor.state.doc.firstChild?.attrs).toMatchObject({ align, anchor: 'flow', widthMm: 30 })
    expect(editor.state.doc.child(1).textContent).toBe('Text beside image')
    expect(editor.state.doc.child(2).textContent).toBe('More text')
    const saved = (editor.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown()
    const placement = host.querySelector<HTMLSelectElement>('[aria-label="Text placement"]')!
    await act(async () => { placement.value = 'flow'; placement.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(editor.getAttributes('image').align).toBe(align)
    editor.commands.setContent(saved)
    expect(editor.state.doc.firstChild?.attrs.align).toBe(align)
    expect(editor.state.doc.child(1).textContent).toBe('Text beside image')
  } finally { await act(async () => root.unmount()); editor.destroy() }
})
