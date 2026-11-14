import { afterEach, expect, it } from 'vitest'
import { DEFAULT_PANELS, useSettingsStore } from './settingsStore'

afterEach(() => useSettingsStore.setState({ panels: DEFAULT_PANELS }))

it('shows every panel until one is turned off, and toggles them independently', () => {
  expect(useSettingsStore.getState().panels).toEqual({ files: true, templates: true, snippets: true, git: true, properties: true, documentIndex: true, bottomPanel: false })
  useSettingsStore.getState().togglePanel('git')
  expect(useSettingsStore.getState().panels).toMatchObject({ git: false, files: true })
})

it('restores a saved layout and ignores anything that is not a known on/off value', () => {
  useSettingsStore.getState().restorePanels({ files: false, snippets: false, git: 'no', bogus: false })
  expect(useSettingsStore.getState().panels).toEqual({ ...DEFAULT_PANELS, files: false, snippets: false })
  useSettingsStore.getState().restorePanels(undefined)
  expect(useSettingsStore.getState().panels.files).toBe(false)
})

it('updates marginMm within bounds and clamps invalid values', () => {
  useSettingsStore.getState().setMarginMm(20)
  expect(useSettingsStore.getState().marginMm).toBe(20)

  useSettingsStore.getState().setMarginMm(2)
  expect(useSettingsStore.getState().marginMm).toBe(5)

  useSettingsStore.getState().setMarginMm(80)
  expect(useSettingsStore.getState().marginMm).toBe(50)
})

it('toggles showPrintMarks in store', () => {
  expect(useSettingsStore.getState().showPrintMarks).toBe(false)
  useSettingsStore.getState().setShowPrintMarks(true)
  expect(useSettingsStore.getState().showPrintMarks).toBe(true)
  useSettingsStore.getState().setShowPrintMarks(false)
  expect(useSettingsStore.getState().showPrintMarks).toBe(false)
})
