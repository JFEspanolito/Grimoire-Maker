import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import type { NodeViewProps } from '@tiptap/react'
import { ImageView } from './ImageView'

const mocks = vi.hoisted(() => ({ load: vi.fn(), revoke: vi.fn() }))
vi.mock('../../../lib/images', () => ({ loadImageUrl: mocks.load, revokeImageUrl: mocks.revoke }))
vi.mock('@tiptap/react', () => ({ NodeViewWrapper: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))
vi.mock('../../../lib/errorLogging', () => ({ reportError: vi.fn() }))
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

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
    await act(async () => vi.advanceTimersByTimeAsync(15000))
    expect(container.textContent).toContain('timed out')
    await act(async () => container.querySelector<HTMLButtonElement>('button')!.click())
    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:retry')
    await act(async () => resolve('blob:late'))
    expect(mocks.revoke).toHaveBeenCalledWith('blob:late')
    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:retry')
  } finally { await act(async () => root.unmount()) }
  expect(mocks.revoke).toHaveBeenCalledWith('blob:retry')
})
