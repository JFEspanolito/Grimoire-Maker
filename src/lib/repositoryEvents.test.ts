import { expect, it, vi } from 'vitest'
import { notifyRepositoryChanged, REPOSITORY_CHANGED } from './repositoryEvents'

it('notifies repository subscribers once per operation and respects listener cleanup', () => {
  const listener = vi.fn()
  window.addEventListener(REPOSITORY_CHANGED, listener)
  try {
    notifyRepositoryChanged()
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0][0]).toBeInstanceOf(Event)
  } finally { window.removeEventListener(REPOSITORY_CHANGED, listener) }
  notifyRepositoryChanged()
  expect(listener).toHaveBeenCalledTimes(1)
})
