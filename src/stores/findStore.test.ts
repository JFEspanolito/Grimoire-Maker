import { beforeEach, expect, it } from 'vitest'
import { useFindStore } from './findStore'
const initial = useFindStore.getState()
beforeEach(() => useFindStore.setState(initial))

it('preserves search options across closing while a new selection seeds and focuses replacement', () => {
  const actions = useFindStore.getState()
  actions.set({ term: 'previous', replacement: 'new', scope: 'project', regex: true, wholeWord: true })
  actions.show(); actions.hide(); actions.show({ replace: true, seed: 'selection' })
  expect(useFindStore.getState()).toMatchObject({ open: true, term: 'selection', replacement: 'new', scope: 'project', regex: true, wholeWord: true, focusTarget: 'replace', focusToken: 2 })
  actions.hide(); actions.show()
  expect(useFindStore.getState()).toMatchObject({ term: 'selection', focusTarget: 'find', focusToken: 3 })
})

it('issues distinct navigation requests even when the direction repeats', () => {
  const requests: number[] = []
  const unsubscribe = useFindStore.subscribe(state => requests.push(state.step.token))
  try { useFindStore.getState().requestStep(1); useFindStore.getState().requestStep(1); useFindStore.getState().requestStep(-1) }
  finally { unsubscribe() }
  expect(requests).toEqual([1, 2, 3])
  expect(useFindStore.getState().step.direction).toBe(-1)
})
