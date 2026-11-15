import { beforeEach, expect, it, vi } from 'vitest'
import { useThemeStore } from './themeStore'
import { loadUserThemes, type ThemeInfo } from '../lib/themes'
vi.mock('../lib/themes', () => ({ BUILTIN_THEMES: [], installBuiltinThemes: vi.fn(), loadUserThemes: vi.fn() }))
vi.mock('../lib/modLibrary', () => ({ prepareModLibrary: async () => ({ preferences: '/prefs' }), readDisabledMods: async () => [] }))
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
beforeEach(() => {
  vi.mocked(loadUserThemes).mockReset()
  useThemeStore.setState({ themes: [], userThemes: [], templateThemes: [], errors: [], dir: null })
})
it.each(['success', 'failure'])('ignores an older reload %s and keeps current template themes', async (outcome) => {
  const previous = deferred<Awaited<ReturnType<typeof loadUserThemes>>>()
  vi.mocked(loadUserThemes).mockReturnValueOnce(previous.promise)
  const first = useThemeStore.getState().reload()
  await vi.waitFor(() => expect(loadUserThemes).toHaveBeenCalledTimes(1))
  const latest: ThemeInfo = { id: 'latest', name: 'Latest', builtin: false }
  vi.mocked(loadUserThemes).mockResolvedValueOnce({ dir: '/latest', themes: [latest], errors: [] })
  await useThemeStore.getState().reload()
  const template: ThemeInfo = { id: 'template', name: 'Template', builtin: false }
  useThemeStore.getState().setTemplateThemes([template])
  if (outcome === 'success') previous.resolve({ dir: '/old', themes: [], errors: ['old warning'] })
  else previous.reject(new Error('old failure'))
  await first
  expect(useThemeStore.getState()).toMatchObject({ dir: '/latest', themes: [latest, template], userThemes: [latest], errors: [] })
})
it('still reports the most recent reload failure', async () => {
  vi.mocked(loadUserThemes).mockRejectedValue(new Error('Permission denied'))
  await useThemeStore.getState().reload()
  expect(useThemeStore.getState().errors).toEqual(['Could not read the themes folder: Permission denied'])
})
