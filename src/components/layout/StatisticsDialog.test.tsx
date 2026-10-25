import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { StatisticsDialog } from './StatisticsDialog'
import { useDocumentStore } from '../../stores/documentStore'

it('shows statistics for open documents with Word Frequency collapsed by default', async () => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: vi.fn() })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: vi.fn() })
  useDocumentStore.getState().resetDocuments()
  useDocumentStore.getState().setBody('asd asd asd asd sda sda')
  const onClose = vi.fn()
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    await act(async () => root.render(<StatisticsDialog onClose={onClose} />))
    const text = container.textContent!
    expect(text).toContain('Words:6')
    expect(text).toContain('Documents:1')
    expect(text).toContain('Reading Time:00:00:02')
    const frequency = container.querySelector('details')!
    expect(frequency.open).toBe(false)
    expect(frequency.querySelector('summary')!.textContent).toBe('Word Frequency')
    expect(Array.from(frequency.querySelectorAll('tbody tr')).map((row) => row.textContent)).toEqual(['asd4100%', 'sda250%'])
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Close Statistics"]')!.click())
    expect(onClose).toHaveBeenCalledOnce()
  } finally { await act(async () => root.unmount()); useDocumentStore.getState().resetDocuments() }
})
