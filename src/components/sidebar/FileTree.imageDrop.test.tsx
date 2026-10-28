import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import type { DragMoveEvent, DndContextProps } from '@dnd-kit/core'
import { FileTree } from './FileTree'
import { useDocumentStore } from '../../stores/documentStore'

const mocks = vi.hoisted(() => ({ target: vi.fn(), handlers: {} as DndContextProps }))
vi.mock('../../lib/snippetDrop', () => ({ findSnippetDropTarget: mocks.target }))
vi.mock('../../hooks/useFileSystem', () => ({ useFileSystem: () => ({}) }))
vi.mock('@dnd-kit/core', () => ({
  DndContext: (props: DndContextProps) => { mocks.handlers = props; return props.children },
  DragOverlay: ({ children }: { children: ReactNode }) => children,
  useSensors: vi.fn(), useSensor: vi.fn(), PointerSensor: {}, pointerWithin: vi.fn(),
  useDroppable: () => ({ setNodeRef: vi.fn() }),
}))

it('shows an image insertion caret and clears it outside the page, on cancellation and for non-images', async () => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  useDocumentStore.getState().setWorkspace('/book', [])
  const root = createRoot(document.createElement('div'))
  const move = { active: { id: '/book/Assets/Chapter 1/file.jpg' }, activatorEvent: new MouseEvent('pointerdown', { clientX: 10, clientY: 20 }), delta: { x: 30, y: 40 } } as unknown as DragMoveEvent
  mocks.target.mockReturnValue({ position: 4, editor: { view: { coordsAtPos: () => ({ left: 100, top: 200, bottom: 224 }) } } })
  try {
    await act(async () => root.render(<FileTree />))
    await act(async () => mocks.handlers.onDragMove!(move))
    expect(mocks.target).toHaveBeenCalledWith(40, 60)
    expect(document.querySelector<HTMLElement>('[data-image-drop-caret]')?.style.left).toBe('100px')
    await act(async () => mocks.handlers.onDragMove!({ ...move, active: { ...move.active, id: '/book/file.md' } }))
    expect(document.querySelector('[data-image-drop-caret]')).toBeNull()
    await act(async () => mocks.handlers.onDragMove!(move))
    await act(async () => mocks.handlers.onDragCancel!(move))
    expect(document.querySelector('[data-image-drop-caret]')).toBeNull()
    await act(async () => mocks.handlers.onDragMove!(move))
    mocks.target.mockReturnValue(null)
    await act(async () => mocks.handlers.onDragMove!(move))
    expect(document.querySelector('[data-image-drop-caret]')).toBeNull()
  } finally {
    await act(async () => root.unmount())
    useDocumentStore.getState().setWorkspace(null, [])
  }
})
