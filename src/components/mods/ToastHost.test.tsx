import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'
import { ToastHost } from './ToastHost'
import { useToastStore } from '../../stores/toastStore'

afterEach(() => useToastStore.setState({ toasts: [] }))

it('announces toasts in a status region and renders nothing when empty', async () => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  const container = document.createElement('div')
  const root = createRoot(container)
  await act(async () => root.render(<ToastHost />))
  expect(container.querySelector('[role="status"]')).toBeNull()
  await act(async () => { useToastStore.getState().show('Hello', 0) })
  expect(container.querySelector('[role="status"]')?.textContent).toBe('Hello')
  await act(async () => root.unmount())
})
