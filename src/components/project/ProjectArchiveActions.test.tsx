import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { packProject, restoreProject } from '../../lib/projectArchive'
import { ProjectArchiveActions } from './ProjectArchiveActions'

vi.mock('../../lib/projectArchive', () => ({ packProject: vi.fn(), restoreProject: vi.fn() }))
let root: Root
let host: HTMLDivElement
beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })
it('disables packing but permits restoring without an active project', async () => {
  await act(async () => root.render(<ProjectArchiveActions workspacePath={null} onRestored={vi.fn()} />))
  expect(host.querySelectorAll('button')[0]!.disabled).toBe(true)
  expect(host.querySelectorAll('button')[1]!.disabled).toBe(false)
})
it('locks both actions during pack and displays its resulting path', async () => {
  let finish!: (path: string) => void
  vi.mocked(packProject).mockReturnValue(new Promise((resolve) => { finish = resolve }))
  await act(async () => root.render(<ProjectArchiveActions workspacePath="/project" onRestored={vi.fn()} />))
  const pack = host.querySelector('button')!
  await act(async () => { pack.click(); pack.click() })
  expect(packProject).toHaveBeenCalledOnce()
  expect([...host.querySelectorAll('button')].every((button) => button.disabled)).toBe(true)
  await act(async () => finish('/backup.zip'))
  expect(host.textContent).toContain('/backup.zip')
})
it('opens the restored project only after successful extraction and reports errors', async () => {
  const onRestored = vi.fn()
  vi.mocked(restoreProject).mockResolvedValueOnce('/restored').mockRejectedValueOnce('Invalid ZIP')
  await act(async () => root.render(<ProjectArchiveActions workspacePath="/project" onRestored={onRestored} />))
  await act(async () => host.querySelectorAll('button')[1]!.click())
  expect(onRestored).toHaveBeenCalledWith('/restored')
  await act(async () => host.querySelectorAll('button')[1]!.click())
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Invalid ZIP')
  expect(onRestored).toHaveBeenCalledOnce()
})
