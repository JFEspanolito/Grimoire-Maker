import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import type { Editor } from '@tiptap/react'
import { EditorCanvas } from '../EditorCanvas'
import { useDocumentStore } from '../../../stores/documentStore'
import { useSettingsStore } from '../../../stores/settingsStore'
import { registerPlugin } from '../../../plugins/plugin-manager'
import type { PluginApi } from '../../../types/plugin'

vi.mock('../../../lib/images', () => ({ loadImageUrl: vi.fn(async () => 'blob:map'), revokeImageUrl: vi.fn() }))
let root: Root | null = null
beforeAll(() => Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true))
afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = null
  document.body.replaceChildren()
})
async function mount(content: string) {
  useDocumentStore.getState().loadFromRaw('/workspace/Draft/boxes.md', content)
  useSettingsStore.setState({ pageSize: 'a4' })
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  let editor!: Editor
  await act(async () => root?.render(<EditorCanvas onReady={(value) => { editor = value }} />))
  editor.setOptions({ editorProps: { handleScrollToSelection: () => true } })
  return { container, editor }
}
function pointer(type: string, x: number, y: number) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 })
  Object.defineProperty(event, 'pointerId', { value: 1 })
  return event
}
const boxHtml = (placement: string) => `<div data-type="standard-content-box" data-placement="${placement}" data-width-mm="40" data-x-mm="30" data-y-mm="40"><h2>Group</h2><p>Editable text</p></div>`

it('routes future plugins through the standard group while loaded and typed content stay plain', async () => {
  const { editor } = await mount('Existing text')
  let api!: PluginApi
  registerPlugin({ id: 'test-standard-box', name: 'Box test', version: '1', activate: (value) => { api = value } })
  await act(async () => {
    editor.commands.setTextSelection((editor.state.doc.content.size - 1) - 1)
    api.insertContent('## Plugin title\n\nPlugin body')
  })
  expect(editor.state.doc.firstChild!.child(0).type.name).toBe('paragraph')
  expect(editor.state.doc.firstChild!.child(1).type.name).toBe('standardContentBox')
  expect(editor.state.doc.firstChild!.child(1).textContent).toBe('Plugin titlePlugin body')
  expect(editor.state.doc.firstChild!.child(1).attrs.placement).toBe('flow')
  await act(async () => editor.commands.insertContentAt(2, 'typed'))
  expect(editor.state.doc.firstChild!.firstChild?.textContent).toContain('typed')
  expect(editor.state.doc.firstChild!.firstChild?.type.name).toBe('paragraph')
})

it('moves a free box relative to its own scaled page and undoes the entire gesture once', async () => {
  const { container, editor } = await mount(boxHtml('free'))
  const box = container.querySelector<HTMLElement>('.grimoire-content-box')!
  const page = container.querySelector<HTMLElement>('.grimoire-page')!
  const handle = box.querySelector<HTMLButtonElement>('[aria-label="Move content box"]')!
  vi.spyOn(page, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 50, width: 840, height: 1188 } as DOMRect)
  vi.spyOn(box, 'getBoundingClientRect').mockReturnValue({ left: 220, top: 210, width: 160, height: 120 } as DOMRect)
  const before = editor.getJSON()
  await act(async () => handle.dispatchEvent(pointer('pointerdown', 220, 210)))
  await act(async () => window.dispatchEvent(pointer('pointermove', 300, 330)))
  expect(box.style.left).toBe('50mm')
  expect(editor.state.doc.firstChild!.firstChild?.attrs.xMm).toBe(30)
  await act(async () => window.dispatchEvent(pointer('pointerup', 300, 330)))
  expect(editor.state.doc.firstChild!.firstChild?.attrs).toMatchObject({ placement: 'free', xMm: 50, yMm: 70, widthMm: 40 })
  expect(editor.state.doc.textContent).toBe('GroupEditable text')
  await act(async () => editor.commands.undo())
  expect(editor.getJSON()).toEqual(before)
  await act(async () => editor.commands.redo())
  expect(editor.state.doc.firstChild!.firstChild?.attrs.xMm).toBe(50)
  await act(async () => handle.dispatchEvent(pointer('pointerdown', 220, 210)))
  await act(async () => window.dispatchEvent(pointer('pointermove', 340, 370)))
  await act(async () => window.dispatchEvent(pointer('pointercancel', 340, 370)))
  expect(editor.state.doc.firstChild!.firstChild?.attrs.xMm).toBe(50)
})

it('reorders a flow box from the handle without changing placement or child content', async () => {
  const { container, editor } = await mount(`${boxHtml('flow')}\n\nAfter`)
  const box = container.querySelector<HTMLElement>('.grimoire-content-box')!
  const page = container.querySelector<HTMLElement>('.grimoire-page')!
  vi.spyOn(page, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 420, height: 594 } as DOMRect)
  vi.spyOn(box, 'getBoundingClientRect').mockReturnValue({ left: 40, top: 40, width: 80, height: 80 } as DOMRect)
  vi.spyOn(editor.view, 'posAtCoords').mockReturnValue({ pos: (editor.state.doc.content.size - 1), inside: -1 })
  const handle = box.querySelector<HTMLButtonElement>('[aria-label="Move content box"]')!
  await act(async () => handle.dispatchEvent(pointer('pointerdown', 40, 40)))
  await act(async () => window.dispatchEvent(pointer('pointermove', 40, 220)))
  await act(async () => window.dispatchEvent(pointer('pointerup', 40, 220)))
  expect(editor.state.doc.firstChild!.child(0).textContent).toBe('After')
  expect(editor.state.doc.firstChild!.child(1).attrs.placement).toBe('flow')
  expect(editor.state.doc.firstChild!.child(1).textContent).toBe('GroupEditable text')
  await act(async () => editor.commands.undo())
  expect(editor.state.doc.firstChild!.firstChild?.type.name).toBe('standardContentBox')
})

it('switches placement and width with local controls while retaining editable children', async () => {
  const { container, editor } = await mount(boxHtml('flow'))
  const box = container.querySelector<HTMLElement>('.grimoire-content-box')!
  const page = container.querySelector<HTMLElement>('.grimoire-page')!
  vi.spyOn(page, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 420, height: 594 } as DOMRect)
  vi.spyOn(box, 'getBoundingClientRect').mockReturnValue({ left: 60, top: 80, width: 80, height: 100 } as DOMRect)
  const select = box.querySelector<HTMLSelectElement>('select')!
  await act(async () => { select.value = 'free'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  expect(editor.state.doc.firstChild!.firstChild?.attrs).toMatchObject({ placement: 'free', xMm: 30, yMm: 40, widthMm: 40 })
  expect(box.style.position).toBe('absolute')
  await act(async () => { select.value = 'flow'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  expect(editor.state.doc.firstChild!.firstChild?.attrs).toMatchObject({ placement: 'flow', xMm: null, yMm: null })
  expect(box.querySelector('[data-node-view-content]')?.getAttribute('contenteditable')).not.toBe('false')
  expect(box.querySelector('.grimoire-box-controls')?.getAttribute('contenteditable')).toBe('false')
  await act(async () => editor.commands.setTextSelection(3))
  expect(box.dataset.selected).toBe('true')
  await act(async () => editor.commands.insertContentAt(2, 'Edited '))
  expect(editor.state.doc.firstChild!.firstChild?.textContent).toContain('Edited Group')
})

it('keeps nested image dragging relative to its free group', async () => {
  const {container,editor}=await mount('<div data-type="standard-content-box" data-placement="free" data-width-mm="100" data-x-mm="30" data-y-mm="40"><p>Group</p><img src="assets/map.png" data-anchor="free" data-x-mm="10" data-y-mm="15" data-width-mm="20" /></div>')
  const image=container.querySelector<HTMLImageElement>('.grimoire-image img')!
  const page=container.querySelector<HTMLElement>('.grimoire-page')!
  const box=container.querySelector<HTMLElement>('.grimoire-content-box')!
  expect(image).not.toBeNull()
  expect(box.style.position).toBe('absolute')
  vi.spyOn(page,'getBoundingClientRect').mockReturnValue({left:0,top:0,width:420,height:594} as DOMRect)
  vi.spyOn(box,'getBoundingClientRect').mockReturnValue({left:60,top:80,width:200,height:200} as DOMRect)
  vi.spyOn(image,'getBoundingClientRect').mockReturnValue({left:80,top:110,width:40,height:40} as DOMRect)
  await act(async()=>image.dispatchEvent(pointer('pointerdown',80,110)))
  await act(async()=>window.dispatchEvent(pointer('pointermove',100,130)))
  await act(async()=>window.dispatchEvent(pointer('pointerup',100,130)))
  let attrs:Record<string,unknown>|undefined
  editor.state.doc.descendants(node=>{if(node.type.name==='image')attrs=node.attrs})
  expect(attrs).toMatchObject({anchor:'free',xMm:20,yMm:25,widthMm:20})
})

it('sizes a content box vertically and deletes its whole group in one undoable action', async () => {
  const { container, editor } = await mount(`${boxHtml('flow')}\n\nKeep this paragraph`)
  const box = container.querySelector<HTMLElement>('.grimoire-content-box')!
  const controls = box.querySelector('.grimoire-box-controls')!
  expect(controls.textContent).not.toContain('(mm)')
  const height = controls.querySelector<HTMLInputElement>('[aria-label="Content box height"]')!
  expect(height).not.toBeNull()
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(height, '80')
    height.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(editor.state.doc.firstChild!.firstChild?.attrs.heightMm).toBe(80)
  expect(box.style.minHeight).toBe('80mm')
  const before = editor.getJSON()
  await act(async () => controls.querySelector<HTMLButtonElement>('[aria-label="Delete content box"]')!.click())
  expect(editor.state.doc.textContent).toBe('Keep this paragraph')
  expect(container.querySelector('.grimoire-content-box')).toBeNull()
  await act(async () => editor.commands.undo())
  expect(editor.getJSON()).toEqual(before)
})
