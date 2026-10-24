import { afterEach, expect, it, vi } from 'vitest'
import { writeTextFile } from '@tauri-apps/plugin-fs'
import { saveSettings } from './preferences'
import { watchSettings } from './appState'
import { useSettingsStore } from '../stores/settingsStore'
import { useSessionStore } from '../stores/sessionStore'

vi.mock('./preferences', () => ({ saveSettings: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn(), mkdir: vi.fn(), readTextFile: vi.fn(), writeTextFile: vi.fn(),
}))
let stop: (() => void) | undefined
afterEach(() => { stop?.(); useSettingsStore.setState({ theme: 'parchment', rulerGuides: [] }); vi.clearAllMocks() })

it('saves appearance through the shared native settings writer, not workspace state', async () => {
  stop = watchSettings()
  useSettingsStore.getState().setTheme('sci-fi')
  await Promise.resolve()
  expect(saveSettings).toHaveBeenCalledWith({ pageSize: 'a4', columns: 2, theme: 'sci-fi', rulerGuides: [] })
  expect(writeTextFile).not.toHaveBeenCalled()
})

it('persists guides through setting.json without writing document or session files', async () => {
  stop = watchSettings()
  const rulerGuides = [{ id: 'row-1', axis: 'row' as const, positionMm: 45 }]
  useSettingsStore.getState().setRulerGuides(rulerGuides)
  await Promise.resolve()
  expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ rulerGuides }))
  expect(writeTextFile).not.toHaveBeenCalled()
})

it('surfaces save failures instead of leaving an unhandled rejection', async () => {
  vi.mocked(saveSettings).mockRejectedValueOnce(new Error('disk full'))
  stop = watchSettings()
  useSettingsStore.getState().setTheme('sci-fi')
  await Promise.resolve()
  expect(useSessionStore.getState().workspaceError).toBe('Could not save preferences: disk full')
})
