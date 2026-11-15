import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import { AutoSaveSettings } from './AutoSaveSettings'
import { useSettingsStore } from '../../stores/settingsStore'

it('lets translated labels name autosave controls in Spanish', async () => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  const previous = useSettingsStore.getState().language
  useSettingsStore.setState({ language: 'es' })
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    await act(async () => root.render(<AutoSaveSettings />))
    expect(container.querySelector('label')?.textContent).toBe('Minutos')
    expect(container.querySelector('input')?.hasAttribute('aria-label')).toBe(false)
    expect(container.querySelector('[aria-label="Enable auto commits"]')).toBeNull()
  } finally {
    await act(async () => root.unmount())
    useSettingsStore.setState({ language: previous })
  }
})
