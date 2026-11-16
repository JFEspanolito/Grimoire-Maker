import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import type { NodeViewProps } from '@tiptap/react'
import { ImageView } from './ImageView'

const mocks = vi.hoisted(() => ({ load: vi.fn(), revoke: vi.fn() }))
vi.mock('../../../lib/images', () => ({ loadImageUrl: mocks.load, revokeImageUrl: mocks.revoke }))
vi.mock('@tiptap/react', () => ({ NodeViewWrapper: (props: React.HTMLAttributes<HTMLDivElement>) => <div {...props} /> }))
vi.mock('../../../lib/errorLogging', () => ({ reportError: vi.fn() }))
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

it('clears decoded state when the source changes and ignores the previous source response', async () => {
  let finish!: (url: string) => void
  mocks.load.mockReturnValueOnce(new Promise<string>(resolve => { finish = resolve }))
    .mockResolvedValueOnce('blob:next')
  const container = document.createElement('div')
  const root = createRoot(container)
  const props = { node: { attrs: { src: 'old.png', anchor: 'flow' } }, selected: false } as unknown as NodeViewProps
  const next = { ...props, node: { attrs: { src: 'next.png', anchor: 'flow' } } } as unknown as NodeViewProps
  try {
    await act(async () => root.render(<ImageView {...props} />))
    await act(async () => root.render(<ImageView {...next} />))
    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:next')
    expect(container.querySelector('.grimoire-image')?.getAttribute('data-image-state')).toBe('loading')
    await act(async () => finish('blob:old'))
    expect(mocks.revoke).toHaveBeenCalledWith('blob:old')
    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:next')
    await act(async () => container.querySelector('img')!.dispatchEvent(new Event('load')))
    expect(container.querySelector('.grimoire-image')?.getAttribute('data-image-state')).toBe('ready')
  } finally { await act(async () => root.unmount()) }
})

it('hides the resize handle outside the clipping viewport and restores it after scrolling', async () => {
  mocks.load.mockResolvedValue('blob:map')
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const viewport = document.body.appendChild(document.createElement('div'))
  viewport.style.overflow = 'auto'
  const page = viewport.appendChild(document.createElement('div')); page.className = 'grimoire-page'
  let bottom = 500
  const bounds = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return this.tagName === 'IMG' ? new DOMRect(100, bottom - 100, 100, 100) : new DOMRect(50, 100, 400, 300)
  })
  const root = createRoot(page)
  const props = { node: { attrs: { src: 'map.jpeg', anchor: 'flow' } }, selected: true } as unknown as NodeViewProps
  try {
    await act(async () => root.render(<ImageView {...props} />))
    expect(document.querySelector('[aria-label="Resize image"]')).toBeNull()
    bottom = 300
    await act(async () => window.dispatchEvent(new Event('scroll')))
    expect(document.querySelector('[aria-label="Resize image"]')).not.toBeNull()
    bottom = -10
    await act(async () => window.dispatchEvent(new Event('scroll')))
    expect(document.querySelector('[aria-label="Resize image"]')).toBeNull()
  } finally {
    await act(async () => root.unmount()); viewport.remove(); bounds.mockRestore(); vi.unstubAllGlobals()
  }
})

it('applies column span to the wrapper while preserving the image width', async () => {
  mocks.load.mockResolvedValue('blob:map')
  const container = document.createElement('div')
  const root = createRoot(container)
  const props = { node: { attrs: { src: 'map.jpeg', anchor: 'flow', align: 'center', widthMm: 91, columnSpan: 'all' } }, selected: false } as unknown as NodeViewProps
  try {
    await act(async () => root.render(<ImageView {...props} />))
    expect(container.querySelector('.grimoire-image')?.getAttribute('data-column-span')).toBe('all')
    expect(container.querySelector('img')?.style.width).toBe('91mm')
    const unspanned = { ...props, node: { attrs: { ...props.node.attrs, columnSpan: null } } } as unknown as NodeViewProps
    await act(async () => root.render(<ImageView {...unspanned} />))
    expect(container.querySelector('.grimoire-image')?.hasAttribute('data-column-span')).toBe(false)
  } finally { await act(async () => root.unmount()) }
})

it('marks an image ready only after decode and marks actual image load failures as errors', async () => {
  mocks.load.mockResolvedValue('blob:map')
  const container = document.createElement('div')
  const root = createRoot(container)
  const props = { node: { attrs: { src: 'map.jpeg', anchor: 'flow' } }, selected: false } as unknown as NodeViewProps
  try {
    await act(async () => root.render(<ImageView {...props} />))
    expect(container.querySelector('.grimoire-image')?.getAttribute('data-image-state')).toBe('loading')
    await act(async () => container.querySelector('img')!.dispatchEvent(new Event('load')))
    expect(container.querySelector('.grimoire-image')?.getAttribute('data-image-state')).toBe('ready')
    await act(async () => container.querySelector('img')!.dispatchEvent(new Event('error')))
    expect(container.querySelector('.grimoire-image')?.getAttribute('data-image-state')).toBe('error')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Unable to decode image')
  } finally { await act(async () => root.unmount()) }
})

it('expires a stalled read, retries successfully, and revokes late results', async () => {
  vi.useFakeTimers()
  let resolve!: (url: string) => void
  mocks.load.mockReturnValueOnce(new Promise<string>(done => { resolve = done }))
    .mockResolvedValueOnce('blob:retry')
  const container = document.createElement('div')
  const root = createRoot(container)
  const props = { node: { attrs: { src: '../../Assets/Chapter 1/file.jpg', anchor: 'flow' } }, selected: false } as unknown as NodeViewProps
  try {
    await act(async () => root.render(<ImageView {...props} />))
    expect(container.textContent).toContain('Loading image')
    expect(container.querySelector('.grimoire-image')?.getAttribute('data-image-state')).toBe('loading')
    await act(async () => vi.advanceTimersByTimeAsync(15000))
    expect(container.textContent).toContain('timed out')
    expect(container.querySelector('.grimoire-image')?.getAttribute('data-image-state')).toBe('error')
    await act(async () => container.querySelector<HTMLButtonElement>('button')!.click())
    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:retry')
    await act(async () => resolve('blob:late'))
    expect(mocks.revoke).toHaveBeenCalledWith('blob:late')
    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:retry')
  } finally { await act(async () => root.unmount()) }
  expect(mocks.revoke).toHaveBeenCalledWith('blob:retry')
})
