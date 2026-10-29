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
afterEach(() => { stop?.(); useSettingsStore.setState({ theme: 'parchment', rulerGuides: [], zoom: 1, autoSaveSeconds: 300, autoCommitEnabled: true, autoCommitMinutes: 20, autoCommitMessage: 'update content automatically', language: 'en' }); vi.clearAllMocks() })

it('saves appearance through the shared native settings writer, not workspace state', async () => {
  stop = watchSettings()
  useSettingsStore.getState().setTheme('sci-fi')
  await Promise.resolve()
  expect(saveSettings).toHaveBeenCalledWith({ pageSize: 'a4', columns: 2, theme: 'sci-fi', rulerGuides: [], panels: expect.objectContaining({ files: true, documentIndex: true }), zoom: 1, autoSaveSeconds: 300, autoCommitEnabled: true, autoCommitMinutes: 20, autoCommitMessage: 'update content automatically', language: 'en' })
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

it('persists editor zoom through setting.json', async () => {
  stop = watchSettings()
  useSettingsStore.getState().setZoom(2)
  await Promise.resolve()
  expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ zoom: 2 }))
  expect(writeTextFile).not.toHaveBeenCalled()
})

it('surfaces save failures instead of leaving an unhandled rejection', async () => {
  vi.mocked(saveSettings).mockRejectedValueOnce(new Error('disk full'))
  stop = watchSettings()
  useSettingsStore.getState().setTheme('sci-fi')
  await Promise.resolve()
  expect(useSessionStore.getState().workspaceError).toBe('Could not save preferences: disk full')
})

it('persists the editable auto save interval without touching session files', async () => {
  stop = watchSettings()
  useSettingsStore.getState().setAutoSaveSeconds(90)
  await Promise.resolve()
  expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ autoSaveSeconds: 90 }))
  expect(writeTextFile).not.toHaveBeenCalled()
})


it('persists auto commit preferences and rejects invalid settings atomically', async () => {
  expect(useSettingsStore.getState()).toMatchObject({ autoCommitEnabled: true, autoCommitMinutes: 20, autoCommitMessage: 'update content automatically' })
  stop = watchSettings()
  useSettingsStore.getState().setAutoCommitSettings(false, 45, 'Saved writing')
  await Promise.resolve()
  expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ autoCommitEnabled: false, autoCommitMinutes: 45, autoCommitMessage: 'Saved writing' }))
  for (const [minutes, message] of [[0, 'valid'], [1441, 'valid'], [1.5, 'valid'], [20, '   '], [20, '\0'], [20, 'é'.repeat(2049)]] as const) {
    useSettingsStore.getState().setAutoCommitSettings(true, minutes, message)
    expect(useSettingsStore.getState()).toMatchObject({ autoCommitEnabled: false, autoCommitMinutes: 45, autoCommitMessage: 'Saved writing' })
  }
})

it('saves which panels are shown whenever one is toggled', async () => {
  const unwatch = watchSettings()
  useSettingsStore.getState().togglePanel('snippets')
  expect(saveSettings).toHaveBeenLastCalledWith(expect.objectContaining({ panels: expect.objectContaining({ snippets: false, files: true }) }))
  useSettingsStore.getState().togglePanel('snippets')
  unwatch()
})
it('persists language through setting.json when changed', async () => {
  stop = watchSettings()
  useSettingsStore.getState().setLanguage('es')
  await Promise.resolve()
  expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ language: 'es' }))
  useSettingsStore.getState().setLanguage('en')
})
