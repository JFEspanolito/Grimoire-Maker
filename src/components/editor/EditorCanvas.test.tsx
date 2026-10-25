import { act, useEffect, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import type { Editor } from '@tiptap/react'
import { TextSelection } from '@tiptap/pm/state'
import { useDocumentStore } from '../../stores/documentStore'
import { EditorCanvas } from './EditorCanvas'
import { EditorToolbar } from './EditorToolbar'
import { alignSections } from '../../lib/sectionLayout'

vi.mock('../../lib/images', () => ({
  loadImageUrl: vi.fn(async () => 'blob:map'),
  revokeImageUrl: vi.fn(),
}))

let root: Root | null = null
beforeAll(() => Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true))
it('keeps the loaded image node view across repeated section alignment', async () => {
  useDocumentStore.getState().loadFromRaw('/book/Draft/Chapter 1/page.md', 'asd\n\n<img src="../../Assets/Chapter 1/FB_IMG_1736916217646.jpg" alt="FB_IMG_1736916217646" data-align="center" data-width-mm="55" data-frame="shadow" />')
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root?.render(<EditorCanvas onReady={() => undefined} />))
  const image = container.querySelector('img')
  expect(image).not.toBeNull()
  const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return { height: this.style.height === 'var(--content-height)' ? 100 : 20 } as DOMRect
  })
  try {
    for (let i = 0; i < 3; i++) {
      await act(async () => { alignSections(container); await new Promise(resolve => setTimeout(resolve, 20)) })
      expect(container.querySelector('img')).toBe(image)
    }
    await act(async () => {
      container.querySelector('.ProseMirror p')!.firstChild!.textContent = 'edited text'
      await new Promise(resolve => setTimeout(resolve, 20))
    })
    expect(useDocumentStore.getState().document.body).toContain('edited text')
    expect(container.querySelector('img')).toBe(image)
  } finally { bounds.mockRestore() }
})
afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = null
  document.body.replaceChildren()
})

it('does not mark a loaded Markdown file dirty while synchronizing the editor', async () => {
  useDocumentStore.getState().loadFromRaw(null, '')
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)

  await act(async () => root?.render(<EditorCanvas onReady={() => undefined} />))
  await act(async () => useDocumentStore.getState().loadFromRaw('/workspace/Draft/chapter.md', '# Chapter'))

  expect(useDocumentStore.getState().document.dirty).toBe(false)
  expect(container.textContent).toContain('Chapter')
})

it('focuses the editor when a blank sheet margin is clicked', async () => {
  useDocumentStore.getState().loadFromRaw(null, '# Chapter')
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const editors: Editor[] = []
  await act(async () => root?.render(<EditorCanvas onReady={(value) => { editors.push(value) }} />))
  const editor = editors[0]
  const sheet = container.querySelector('.grimoire-page')
  expect(sheet).not.toBeNull()
  expect(editor).toBeDefined()
  editor.view.dom.blur()

  await act(async () => {
    sheet?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 30))
  })

  expect(document.activeElement).toBe(editor.view.dom)
})

it('drags an image within the sheet and stores the new position in Markdown', async () => {
  useDocumentStore.getState().loadFromRaw('/workspace/Draft/chapter.md', '<img src="assets/map.png" data-anchor="free" />')
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root?.render(<EditorCanvas onReady={() => undefined} />))
  const page = container.querySelector<HTMLElement>('.grimoire-page')!
  const image = container.querySelector<HTMLImageElement>('.grimoire-image img')!
  expect(image).toBeDefined()
  vi.spyOn(page, 'getBoundingClientRect').mockReturnValue({
    left: 0, top: 0, width: 420, height: 594,
  } as DOMRect)
  vi.spyOn(image, 'getBoundingClientRect').mockReturnValue({
    left: 60, top: 80, width: 80, height: 100,
  } as DOMRect)
  const pointer = (type: string, x: number, y: number) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 })
    Object.defineProperty(event, 'pointerId', { value: 1 })
    return event
  }

  const capture = vi.fn()
  Object.defineProperty(image, 'setPointerCapture', { value: capture })
  const start = pointer('pointerdown', 60, 80)
  const beforeClick = useDocumentStore.getState().document.body
  await act(async () => image.dispatchEvent(start))
  expect(start.defaultPrevented).toBe(true)
  expect(capture).toHaveBeenCalledWith(1)
  await act(async () => window.dispatchEvent(pointer('pointerup', 60, 80)))
  expect(useDocumentStore.getState().document.body).toBe(beforeClick)

  await act(async () => image.dispatchEvent(pointer('pointerdown', 60, 80)))
  await act(async () => window.dispatchEvent(pointer('pointermove', 100, 140)))
  await act(async () => window.dispatchEvent(pointer('pointerup', 100, 140)))

  expect(useDocumentStore.getState().document.body).toContain('data-anchor="free"')
  expect(useDocumentStore.getState().document.body).toContain('data-x-mm="50"')
  expect(useDocumentStore.getState().document.body).toContain('data-y-mm="70"')
  expect(useDocumentStore.getState().document.body).toContain('data-width-mm="40"')

  const savedPosition = useDocumentStore.getState().document.body
  await act(async () => image.dispatchEvent(pointer('pointerdown', 100, 140)))
  await act(async () => window.dispatchEvent(pointer('pointermove', 160, 200)))
  await act(async () => window.dispatchEvent(pointer('pointercancel', 160, 200)))
  expect(useDocumentStore.getState().document.body).toBe(savedPosition)
  expect(image.style.left).toBe('50mm')
  expect(image.style.top).toBe('70mm')
})

it('restores a text cursor on margin pointerdown after an image selection', async () => {
  useDocumentStore.getState().loadFromRaw(null, '![Map](assets/map.png)\n\nContinue writing')
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const editors: Editor[] = []
  await act(async () => root?.render(<EditorCanvas onReady={(value) => { editors.push(value) }} />))
  const editor = editors[0]
  await act(async () => { editor.commands.setNodeSelection(1) })
  editor.view.dom.blur()
  const down = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 })
  await act(async () => {
    container.querySelector('.grimoire-page')?.dispatchEvent(down)
    await new Promise((resolve) => setTimeout(resolve, 30))
  })
  expect(down.defaultPrevented).toBe(true)
  expect(document.activeElement).toBe(editor.view.dom)
  expect(editor.state.selection).toBeInstanceOf(TextSelection)
})

it.each(['flow', 'free'])('resizes a selected %s image from its corner without moving it, with cancel and undo', async (anchor) => {
  useDocumentStore.getState().loadFromRaw('/book/chapter.md', `<img src="assets/map.png" data-anchor="${anchor}" data-width-mm="40" data-x-mm="30" data-y-mm="40" />`)
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  let editor!: Editor
  await act(async () => root?.render(<EditorCanvas onReady={(value) => { editor = value }} />))
  const page = container.querySelector<HTMLElement>('.grimoire-page')!
  const image = container.querySelector<HTMLImageElement>('.grimoire-image img')!
  vi.spyOn(page, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 420, height: 594 } as DOMRect)
  vi.spyOn(image, 'getBoundingClientRect').mockReturnValue({ left: 60, top: 80, width: 80, height: 100 } as DOMRect)
  await act(async () => { editor.commands.setNodeSelection(1); image.dispatchEvent(new Event('load')) })
  const handle = container.querySelector<HTMLButtonElement>('[aria-label="Resize image"]')
  expect(handle).not.toBeNull()
  const pointer = (type: string, x: number, y: number) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 })
    Object.defineProperty(event, 'pointerId', { value: 3 })
    return event
  }
  const original = useDocumentStore.getState().document.body
  await act(async () => handle!.dispatchEvent(pointer('pointerdown', 140, 180)))
  await act(async () => window.dispatchEvent(pointer('pointermove', 180, 230)))
  expect(image.style.width).toBe('60mm')
  await act(async () => window.dispatchEvent(pointer('pointercancel', 180, 230)))
  expect(image.style.width).toBe('40mm')
  expect(useDocumentStore.getState().document.body).toBe(original)
  await act(async () => handle!.dispatchEvent(pointer('pointerdown', 140, 180)))
  await act(async () => window.dispatchEvent(pointer('pointermove', 180, 230)))
  await act(async () => window.dispatchEvent(pointer('pointerup', 180, 230)))
  expect(useDocumentStore.getState().document.body).toContain('data-width-mm="60"')
  expect(editor.getAttributes('image')).toMatchObject({ anchor, xMm: 30, yMm: 40, widthMm: 60 })
  const saved = useDocumentStore.getState().document.body
  await act(async () => { editor.commands.undo() })
  expect(editor.getAttributes('image').widthMm).toBe(40)
  await act(async () => { editor.commands.setContent(saved); editor.commands.setNodeSelection(1) })
  expect(editor.getAttributes('image')).toMatchObject({ anchor, xMm: 30, yMm: 40, widthMm: 60 })
})

it('keeps Push text after choosing it, typing, and dragging the image to another text position', async () => {
  useDocumentStore.getState().loadFromRaw('/book/chapter.md', '<img src="assets/map.png" data-anchor="free" data-width-mm="40" />\n\nBefore\n\nAfter')
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  let editor!: Editor
  function Harness() {
    const [active, setActive] = useState<Editor | null>(null)
    useEffect(() => { if (active) editor = active }, [active])
    return <><EditorCanvas onReady={setActive} /><EditorToolbar editor={active} /></>
  }
  await act(async () => root?.render(<Harness />))
  editor.setOptions({ editorProps: { handleScrollToSelection: () => true } })
  await act(async () => { editor.commands.setNodeSelection(1) })
  const placement = container.querySelector<HTMLSelectElement>('[aria-label="Text placement"]')!
  await act(async () => { placement.value = 'flow'; placement.dispatchEvent(new Event('change', { bubbles: true })) })
  expect(editor.getAttributes('image').anchor).toBe('flow')
  await act(async () => {
    editor.commands.setTextSelection(3)
    editor.view.dispatch(editor.state.tr.insertText('Typed '))
  })
  expect(editor.state.doc.firstChild!.firstChild?.attrs.anchor).toBe('flow')
  const page = container.querySelector<HTMLElement>('.grimoire-page')!
  const image = container.querySelector<HTMLImageElement>('.grimoire-image img')!
  vi.spyOn(page, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 420, height: 594 } as DOMRect)
  vi.spyOn(image, 'getBoundingClientRect').mockReturnValue({ left: 60, top: 80, width: 80, height: 100 } as DOMRect)
  vi.spyOn(editor.view, 'posAtCoords').mockImplementation(() => ({ pos: (editor.state.doc.content.size - 1), inside: -1 }))
  const pointer = (type: string, x: number, y: number) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 })
    Object.defineProperty(event, 'pointerId', { value: 1 })
    return event
  }
  await act(async () => image.dispatchEvent(pointer('pointerdown', 60, 80)))
  await act(async () => window.dispatchEvent(pointer('pointermove', 100, 240)))
  await act(async () => window.dispatchEvent(pointer('pointerup', 100, 240)))
  expect(editor.getAttributes('image')).toMatchObject({ anchor: 'flow', widthMm: 40 })
  expect(container.querySelector<HTMLSelectElement>('[aria-label="Text placement"]')?.value).toBe('flow')
  expect(editor.state.doc.firstChild!.firstChild?.type.name).toBe('paragraph')
  expect(editor.getText()).toContain('Typed Before')
  expect(editor.getText()).toContain('After')
  expect(useDocumentStore.getState().document.body).not.toContain('data-anchor="free"')
  const saved = useDocumentStore.getState().document.body
  await act(async () => { editor.commands.undo() })
  expect(editor.state.doc.firstChild!.firstChild?.type.name).toBe('image')
  expect(editor.state.doc.firstChild!.firstChild?.attrs.anchor).toBe('flow')
  expect(editor.getText()).toContain('Typed Before')
  await act(async () => { editor.commands.setContent(saved) })
  const images: string[] = []
  editor.state.doc.descendants((node) => { if (node.type.name === 'image') images.push(node.attrs.anchor) })
  expect(images).toEqual(['flow'])
})

it.each([['left', 40, 40], ['right', 40, 40], ['left', 140, 54], ['right', 140, 54]] as const)(
  'wraps a Push text image on the %s and fits width %s beside a paragraph', async (side, width, fittedWidth) => {
  useDocumentStore.getState().loadFromRaw('/book/chapter.md', `Beside this paragraph\n\n<img src="assets/map.png" data-width-mm="${width}" />`)
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  let editor!: Editor
  await act(async () => root?.render(<EditorCanvas onReady={(value) => { editor = value }} />))
  const page = container.querySelector<HTMLElement>('.grimoire-page')!
  const image = container.querySelector<HTMLImageElement>('.grimoire-image img')!
  const paragraph = container.querySelector('.ProseMirror p')!
  vi.spyOn(page, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 420, height: 594 } as DOMRect)
  vi.spyOn(image, 'getBoundingClientRect').mockReturnValue({ left: 60, top: 160, width: width * 2, height: 100 } as DOMRect)
  vi.spyOn(paragraph, 'getClientRects').mockReturnValue([{ left: 60, right: 300, top: 80, bottom: 140, width: 240, height: 60 }] as unknown as DOMRectList)
  vi.spyOn(editor.view, 'posAtCoords').mockReturnValue({ pos: 2, inside: 0 })
  const pointer = (type: string, x: number, y: number) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 })
    Object.defineProperty(event, 'pointerId', { value: 1 })
    return event
  }
  const x = side === 'left' ? 80 : 280
  await act(async () => image.dispatchEvent(pointer('pointerdown', 80, 180)))
  await act(async () => window.dispatchEvent(pointer('pointermove', x, 100)))
  await act(async () => window.dispatchEvent(pointer('pointerup', x, 100)))
  expect(editor.state.doc.firstChild!.firstChild?.type.name).toBe('image')
  expect(editor.getAttributes('image')).toMatchObject({ align: side, anchor: 'flow', widthMm: fittedWidth })
  expect(editor.state.doc.firstChild!.child(1).textContent).toBe('Beside this paragraph')
  expect(useDocumentStore.getState().document.body).toContain(`data-align="${side}"`)
})

it.each(['left', 'right'])('grows a %s wrapped image within its second column without changing placement', async (align) => {
  useDocumentStore.getState().loadFromRaw('/book/chapter.md', `<img src="assets/map.png" data-align="${align}" data-width-mm="40" />`)
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  let editor!: Editor
  await act(async () => root?.render(<EditorCanvas onReady={value => { editor = value }} />))
  const page = container.querySelector<HTMLElement>('.grimoire-page')!
  const image = container.querySelector<HTMLImageElement>('.grimoire-image img')!
  const wrapper = image.parentElement!
  vi.spyOn(page, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 420, height: 594 } as DOMRect)
  vi.spyOn(image, 'getBoundingClientRect').mockReturnValue({ left: 250, top: 40, width: 80, height: 100 } as DOMRect)
  vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue({ left: 250, top: 40, width: 80, height: 100 } as DOMRect)
  vi.spyOn(wrapper.parentElement!, 'getClientRects').mockReturnValue([
    { left: 20, right: 190, top: 20, bottom: 300, width: 170 },
    { left: 230, right: 400, top: 20, bottom: 300, width: 170 },
  ] as unknown as DOMRectList)
  await act(async () => { editor.commands.setNodeSelection(1); image.dispatchEvent(new Event('load')) })
  const handle = container.querySelector<HTMLButtonElement>('[aria-label="Resize image"]')!
  const pointer = (type: string, x: number, y: number) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y })
    Object.defineProperty(event, 'pointerId', { value: 3 })
    return event
  }
  await act(async () => handle.dispatchEvent(pointer('pointerdown', 330, 140)))
  await act(async () => window.dispatchEvent(pointer('pointermove', 370, 190)))
  expect(image.style.width).toBe('60mm')
  await act(async () => window.dispatchEvent(pointer('pointerup', 370, 190)))
  expect(editor.getAttributes('image')).toMatchObject({ widthMm: 60, align, anchor: 'flow' })
  await act(async () => editor.commands.undo())
  expect(editor.getAttributes('image')).toMatchObject({ widthMm: 40, align, anchor: 'flow' })
  await act(async () => handle.dispatchEvent(pointer('pointerdown', 330, 140)))
  await act(async () => window.dispatchEvent(pointer('pointermove', 1000, 1000)))
  expect(image.style.width).toBe('85mm')
  await act(async () => window.dispatchEvent(pointer('pointercancel', 1000, 1000)))
  expect(image.style.width).toBe('40mm')
})


it('lets an image leave the margin and span across both sheets in Spread view', async () => {
  vi.stubGlobal('CSS', { supports: () => true })
  const { useSettingsStore } = await import('../../stores/settingsStore')
  useSettingsStore.setState({ viewMode: 'spreads', pageSize: 'a4', marginMm: 20 })
  useDocumentStore.getState().loadFromRaw('/book/chapter.md', '<img src="assets/map.png" data-width-mm="120" />')
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  let editor!: Editor
  try {
    await act(async () => root?.render(<EditorCanvas onReady={value => { editor = value }} />))
    const sheets = container.querySelectorAll<HTMLElement>('[data-editor-sheet]')
    expect(sheets).toHaveLength(2)
    vi.spyOn(sheets[0], 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 420, 594))
    vi.spyOn(sheets[1], 'getBoundingClientRect').mockReturnValue(new DOMRect(420, 0, 420, 594))
    const image = container.querySelector<HTMLImageElement>('.grimoire-image img')!
    vi.spyOn(image, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 80, 240, 100))
    const pointer = (type: string, x: number, y: number) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y })
      Object.defineProperty(event, 'pointerId', { value: 1 })
      return event
    }
    await act(async () => image.dispatchEvent(pointer('pointerdown', 100, 80)))
    await act(async () => window.dispatchEvent(pointer('pointermove', 300, 100)))
    await act(async () => window.dispatchEvent(pointer('pointerup', 300, 100)))
    expect(editor.getAttributes('image')).toMatchObject({ anchor: 'free', xMm: 150, yMm: 50, widthMm: 120 })
  } finally {
    await act(async () => useSettingsStore.setState({ viewMode: 'edit' }))
    vi.unstubAllGlobals()
  }
})
