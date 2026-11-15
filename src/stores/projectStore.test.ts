import { beforeEach, expect, it, vi } from 'vitest'
import { EMPTY_PROJECT, loadProjectSettings, saveProjectSettings } from '../lib/projectSettings'
import { useProjectStore } from './projectStore'

vi.mock('../lib/projectSettings', () => ({ EMPTY_PROJECT: { name: '', author: '', coAuthor: '' }, loadProjectSettings: vi.fn(), saveProjectSettings: vi.fn() }))
beforeEach(() => { vi.resetAllMocks(); useProjectStore.setState({ entries: {} }) })

it('keeps late project loads isolated and prevents duplicate reads and premature saves', async () => {
  let finish!: (value: typeof EMPTY_PROJECT) => void
  vi.mocked(loadProjectSettings).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    .mockResolvedValueOnce({ ...EMPTY_PROJECT, name: 'Book B' })
  const a = useProjectStore.getState().load('/a')
  await useProjectStore.getState().load('/a')
  expect(await useProjectStore.getState().save('/a', EMPTY_PROJECT)).toBe(false)
  await useProjectStore.getState().load('/b')
  finish({ ...EMPTY_PROJECT, name: 'Book A' }); await a
  expect(loadProjectSettings).toHaveBeenCalledTimes(2)
  expect(saveProjectSettings).not.toHaveBeenCalled()
  expect(useProjectStore.getState().entries['/a']).toMatchObject({ ready: true, busy: false, settings: { name: 'Book A' } })
  expect(useProjectStore.getState().entries['/b'].settings.name).toBe('Book B')
})

it('retains the last saved settings on write failure and allows a later successful save', async () => {
  vi.mocked(loadProjectSettings).mockResolvedValue({ ...EMPTY_PROJECT, name: 'Saved' })
  await useProjectStore.getState().load('/book')
  vi.mocked(saveProjectSettings).mockRejectedValueOnce(new Error('Disk full')).mockResolvedValueOnce(undefined)
  const next = { ...EMPTY_PROJECT, name: 'Updated' }
  expect(await useProjectStore.getState().save('/book', next)).toBe(false)
  expect(useProjectStore.getState().entries['/book']).toMatchObject({ busy: false, settings: { name: 'Saved' }, error: 'Error: Disk full' })
  expect(await useProjectStore.getState().save('/book', next)).toBe(true)
  expect(useProjectStore.getState().entries['/book']).toMatchObject({ settings: next, error: '', busy: false })
})

it('reports failed reads without making the project writable', async () => {
  vi.mocked(loadProjectSettings).mockRejectedValue(new Error('Invalid metadata'))
  await useProjectStore.getState().load('/book')
  expect(useProjectStore.getState().entries['/book']).toMatchObject({ ready: false, busy: false, error: 'Error: Invalid metadata' })
  expect(await useProjectStore.getState().save('/book', EMPTY_PROJECT)).toBe(false)
})
