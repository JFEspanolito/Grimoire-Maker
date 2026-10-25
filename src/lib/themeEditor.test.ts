import { beforeEach, expect, it, vi } from 'vitest'
import { buildThemeCss, deleteUserTheme, exportUserTheme, loadThemeDraft, saveThemeDraft, themeColors } from './themeEditor'

const fs = vi.hoisted(() => ({ readDir: vi.fn(), readTextFile: vi.fn(), writeTextFile: vi.fn(), rename: vi.fn() }))
const dialog = vi.hoisted(() => ({ save: vi.fn() }))
const core = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/plugin-fs', () => fs)
vi.mock('@tauri-apps/plugin-dialog', () => dialog)
vi.mock('@tauri-apps/api/core', () => core)
vi.mock('./preferences', () => ({ loadLibraryPaths: async () => ({ themes: '/themes', templates: '/templates' }) }))
const source = "/* @name: Custom */\n[data-theme='custom'] { --page-bg: #123456; --page-font: Georgia; }\n[data-theme='custom'] h1 { letter-spacing: .1em; }"
beforeEach(() => {
  vi.resetAllMocks()
  fs.readDir.mockResolvedValue([{ name: 'custom.css', isFile: true, isSymlink: false }])
  fs.readTextFile.mockResolvedValue(source)
})

it('copies selectors while preserving fonts and layout, and overrides six independent colors', () => {
  const colors = { ...themeColors(source), h1: '#112233', h2: '#223344', h3: '#334455', divider: '#445566' }
  const css = buildThemeCss(source, 'custom', 'my-copy', 'My Copy', colors)
  expect(css).toContain('--page-font: Georgia')
  expect(css).toContain('letter-spacing: .1em')
  expect(css).not.toContain("data-theme='custom'")
  expect(css).toContain("[data-theme='my-copy'] .grimoire-content h2")
  expect(css).toContain('border-color: #445566')
  expect(css).toContain('color: #223344')
  expect(css).not.toContain('--heading-color: #112233')
  expect(buildThemeCss(css, 'my-copy', 'my-copy', 'My Copy', colors).match(/grimoire-colors:start/g)).toHaveLength(1)
})

it('rejects injection through names, ids, or color fields', () => {
  expect(() => buildThemeCss(source, 'custom', 'copy', '*/ body {', themeColors(source))).toThrow()
  expect(() => buildThemeCss(source, 'custom', "copy']", 'Copy', themeColors(source))).toThrow()
  expect(() => buildThemeCss(source, 'custom', 'copy', 'Copy', { ...themeColors(source), text: 'red;}' })).toThrow()
})

it('creates a unique sanitized copy exclusively in the configured theme folder', async () => {
  const draft = await loadThemeDraft({ id: 'custom', name: 'Custom', builtin: false }, true)
  const result = await saveThemeDraft(draft, 'Custom', themeColors(source), true, ['custom', 'custom-2'])
  expect(result.id).toBe('custom-3')
  expect(fs.writeTextFile).toHaveBeenCalledWith('/themes/custom-3.css', expect.stringContaining("data-theme='custom-3'"), { createNew: true })
  expect(fs.rename).not.toHaveBeenCalled()
})

it('updates user CSS via a new temporary file and rename without truncating the original', async () => {
  const draft = await loadThemeDraft({ id: 'custom', name: 'Custom', builtin: false }, true)
  await saveThemeDraft(draft, 'Custom', themeColors(source), false, ['custom'])
  expect(fs.writeTextFile.mock.calls[0]?.[0]).toMatch(/^\/themes\/\.custom-.+\.tmp$/)
  expect(fs.writeTextFile.mock.calls[0]?.[2]).toEqual({ createNew: true })
  expect(fs.rename).toHaveBeenCalledWith(fs.writeTextFile.mock.calls[0]?.[0], '/themes/custom.css')
})

it('refuses external source changes and publication failures without unsafe fallback', async () => {
  const draft = await loadThemeDraft({ id: 'custom', name: 'Custom', builtin: false }, true)
  fs.readTextFile.mockResolvedValueOnce('external edit')
  await expect(saveThemeDraft(draft, 'Custom', themeColors(source), false, ['custom'])).rejects.toThrow('changed')
  expect(fs.writeTextFile).not.toHaveBeenCalled()
  fs.rename.mockRejectedValueOnce(new Error('rename denied'))
  await expect(saveThemeDraft(draft, 'Custom', themeColors(source), false, ['custom'])).rejects.toThrow('rename denied')
  expect(fs.writeTextFile).toHaveBeenCalledTimes(1)
})

it('rechecks the original after the temporary write and never renames over a late edit', async () => {
  const draft = await loadThemeDraft({ id: 'custom', name: 'Custom', builtin: false }, true)
  fs.readTextFile.mockResolvedValueOnce(source).mockResolvedValueOnce('late external edit')
  await expect(saveThemeDraft(draft, 'Custom', themeColors(source), false, ['custom'])).rejects.toThrow('changed outside')
  expect(fs.rename).not.toHaveBeenCalled()
  expect(fs.writeTextFile).toHaveBeenCalledTimes(1)
})

it('propagates exclusive creation collisions rather than truncating or retrying', async () => {
  const draft = await loadThemeDraft({ id: 'custom', name: 'Custom', builtin: false }, true)
  fs.writeTextFile.mockRejectedValueOnce(new Error('File exists'))
  await expect(saveThemeDraft(draft, 'Fresh', themeColors(source), true, ['custom'])).rejects.toThrow('File exists')
  expect(fs.writeTextFile).toHaveBeenCalledTimes(1)
  expect(fs.rename).not.toHaveBeenCalled()
})

it('loads template themes as copy-only and refuses linked user files', async () => {
  const template = await loadThemeDraft({ id: 'custom', name: 'Custom', builtin: false }, false)
  expect(template.path).toBeNull()
  expect(fs.readTextFile).toHaveBeenCalledWith('/templates/custom/theme.css')
  fs.readDir.mockResolvedValue([{ name: 'custom.css', isFile: true, isSymlink: true }])
  await expect(loadThemeDraft({ id: 'custom', name: 'Custom', builtin: false }, true)).rejects.toThrow('regular')
})

it('deletes and exports user-owned themes safely', async () => {
  dialog.save.mockResolvedValueOnce('/exports/custom.css')
  expect(await exportUserTheme('custom')).toBe(true)
  expect(fs.writeTextFile).toHaveBeenCalledWith('/exports/custom.css', source)

  dialog.save.mockResolvedValueOnce(null)
  expect(await exportUserTheme('custom')).toBe(false)

  await deleteUserTheme('custom')
  expect(core.invoke).toHaveBeenCalledWith('delete_user_theme', { id: 'custom' })
})
