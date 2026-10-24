import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { ThemeBackgroundEditor } from './ThemeBackgroundEditor'
import type { ThemeDecoration } from '../../lib/themeDecorations'

it('drags artwork into the footer, cancels a gesture, and removes only the selected image', async () => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  const item: ThemeDecoration = { id: 'flowers', name: 'Flowers', dataUrl: 'data:image/png;base64,AA==', widthMm: 40, heightMm: 40, xMm: 5, yMm: 5, anchor: 'header' }
  let current = [item]
  function Host() {
    const [images, setImages] = useState([item])
    return <ThemeBackgroundEditor images={images} onChange={next => { current = next; setImages(next) }} onImport={() => {}} disabled={false} pageWidthMm={210} pageHeightMm={297} background="#fff" foreground="#000" />
  }
  const host = document.createElement('div'), root = createRoot(host)
  const pointer = (type: string, x: number, y: number) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y })
    Object.defineProperty(event, 'pointerId', { value: 1 })
    return event
  }
  try {
    await act(async () => root.render(<Host />))
    vi.spyOn(host.querySelector('[aria-label="Background placement preview"]')!, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 420, height: 594 } as DOMRect)
    const image = host.querySelector<HTMLButtonElement>('[aria-label="Move background Flowers"]')!
    await act(async () => image.dispatchEvent(pointer('pointerdown', 10, 10)))
    await act(async () => window.dispatchEvent(pointer('pointermove', 30, 510)))
    expect(current[0].anchor).toBe('header')
    await act(async () => window.dispatchEvent(pointer('pointerup', 30, 510)))
    expect(current[0]).toMatchObject({ anchor: 'footer', xMm: 15, yMm: 2 })
    await act(async () => image.dispatchEvent(pointer('pointerdown', 30, 510)))
    await act(async () => window.dispatchEvent(pointer('pointermove', 100, 100)))
    await act(async () => window.dispatchEvent(pointer('pointercancel', 100, 100)))
    expect(current[0]).toMatchObject({ anchor: 'footer', xMm: 15, yMm: 2 })
    await act(async () => Array.from(host.querySelectorAll('button')).find(button => button.textContent === 'Remove image')!.click())
    expect(current).toEqual([])
  } finally { await act(async () => root.unmount()) }
})
