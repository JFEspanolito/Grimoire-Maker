import { expect, it } from 'vitest'
import { fileShortcut, findShortcut } from './shortcuts'

it.each([['s', 'saveAll'], ['O', 'openFile'], ['n', 'createNewFile']])('recognizes Ctrl and Command file shortcut %s', (key, action) => {
  expect(fileShortcut(new KeyboardEvent('keydown', { key, ctrlKey: true }))).toBe(action)
  expect(fileShortcut(new KeyboardEvent('keydown', { key, metaKey: true }))).toBe(action)
})
it.each([{ altKey: true }, { shiftKey: true }, { isComposing: true }])('leaves modified or composing file shortcuts to their owner (%j)', extra => {
  expect(fileShortcut(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, ...extra }))).toBeUndefined()
})
it('does not intercept handled events or unmodified typing', () => {
  const event = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, cancelable: true })
  event.preventDefault()
  expect(findShortcut(event)).toBeUndefined()
  expect(fileShortcut(event)).toBeUndefined()
  expect(fileShortcut(new KeyboardEvent('keydown', { key: 's' }))).toBeUndefined()
  expect(findShortcut(new KeyboardEvent('keydown', { key: 'f' }))).toBeUndefined()
})
it('distinguishes search focus and forward/backward match navigation', () => {
  expect(findShortcut(new KeyboardEvent('keydown', { key: 'F', metaKey: true }))).toBe('find')
  expect(findShortcut(new KeyboardEvent('keydown', { key: 'h', ctrlKey: true }))).toBe('replace')
  expect(findShortcut(new KeyboardEvent('keydown', { key: 'F3' }))).toBe('next')
  expect(findShortcut(new KeyboardEvent('keydown', { key: 'F3', shiftKey: true }))).toBe('previous')
  expect(findShortcut(new KeyboardEvent('keydown', { key: 'F3', ctrlKey: true }))).toBeUndefined()
})
