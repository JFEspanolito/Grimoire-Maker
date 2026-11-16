import { beforeEach, expect, it, vi } from 'vitest'
import { useModStore } from './modStore'
import { useTemplateStore } from './templateStore'

vi.mock('./modStore', () => ({ useModStore: { getState: () => ({ reload }) } }))
const { reload } = vi.hoisted(() => ({ reload: vi.fn() }))
const initial = useTemplateStore.getState()
beforeEach(() => { vi.resetAllMocks(); useTemplateStore.setState(initial) })

it('reloads through the shared mod catalog and preserves the previous catalog when scanning fails', async () => {
  const templates = useTemplateStore.getState().templates
  reload.mockRejectedValueOnce(new Error('Permission denied'))
  await useTemplateStore.getState().reload()
  expect(useModStore.getState().reload).toHaveBeenCalledTimes(1)
  expect(useTemplateStore.getState().templates).toBe(templates)
  expect(useTemplateStore.getState().errors).toEqual(['Could not read the templates folder: Permission denied'])
})
