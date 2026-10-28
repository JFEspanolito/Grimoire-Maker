import { expect, it } from 'vitest'
import { useRulerStore } from './rulerStore'

it('starts hidden, toggles and resets', () => {
  expect(useRulerStore.getState().visible).toBe(false)
  useRulerStore.getState().toggle()
  expect(useRulerStore.getState().visible).toBe(true)
  useRulerStore.getState().toggle()
  expect(useRulerStore.getState().visible).toBe(false)
  useRulerStore.getState().toggle()
  useRulerStore.getState().reset()
  expect(useRulerStore.getState().visible).toBe(false)
})
