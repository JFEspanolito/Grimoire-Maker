import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useToastStore } from './toastStore'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers(); useToastStore.setState({ toasts: [] }) })

it('shows a toast and removes it after its timeout', () => {
  const id = useToastStore.getState().show('Saved', 1000)
  expect(useToastStore.getState().toasts).toEqual([{ id, message: 'Saved' }])
  vi.advanceTimersByTime(999)
  expect(useToastStore.getState().toasts).toHaveLength(1)
  vi.advanceTimersByTime(2)
  expect(useToastStore.getState().toasts).toEqual([])
})

it('dismisses one toast without touching the others', () => {
  const first = useToastStore.getState().show('One', 0)
  useToastStore.getState().show('Two', 0)
  useToastStore.getState().dismiss(first)
  expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual(['Two'])
})
