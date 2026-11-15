import { expect, it, vi } from 'vitest'
import { useLayoutStore } from './layoutStore'

it('publishes changed document measurements without notifying subscribers for identical repeats', () => {
  useLayoutStore.setState({ sheets: {} })
  const listener = vi.fn()
  const unsubscribe = useLayoutStore.subscribe(listener)
  try {
    useLayoutStore.getState().setSheets('/a.md', 2)
    const snapshot = useLayoutStore.getState()
    useLayoutStore.getState().setSheets('/a.md', 2)
    expect(useLayoutStore.getState()).toBe(snapshot)
    useLayoutStore.getState().setSheets('/b.md', 3)
    expect(useLayoutStore.getState().sheets).toEqual({ '/a.md': 2, '/b.md': 3 })
    expect(listener).toHaveBeenCalledTimes(2)
  } finally { unsubscribe() }
})
