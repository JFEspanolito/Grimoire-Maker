import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import { DetailLine, PluginCard } from './PluginCard'

async function mount() {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(
    <PluginCard name="Zoom" version="2.0.0" origin="Built in" status="On" description="Change the zoom of the editor."
      actions={<button type="button">Turn off</button>}
      details={<DetailLine label="Id">builtin.zoom</DetailLine>}>
      <span data-extra>extra</span>
    </PluginCard>,
  ))
  return { container, close: async () => { await act(async () => root.unmount()); container.remove() } }
}

it('is made of three rows: name, status and actions; one-line description; Details toggle', async () => {
  const { container, close } = await mount()
  const rows = [...container.querySelectorAll('[data-row]')]
  expect(rows.map((row) => row.getAttribute('data-row'))).toEqual(['1', '2', '3'])
  expect(rows[0].textContent).toContain('Zoom')
  expect(rows[0].textContent).toContain('v2.0.0')
  expect(rows[0].textContent).toContain('Built in')
  expect(rows[0].textContent).toContain('On')
  expect(rows[0].querySelector('button')?.textContent).toBe('Turn off')
  expect(rows[0].querySelector('strong')?.textContent).toBe('Zoom')
  expect(rows[1].textContent).toBe('Change the zoom of the editor.')
  expect(rows[2].textContent).toBe('Details')
  await close()
})

it('keeps the details hidden until the toggle opens them, and reports the state with aria-expanded', async () => {
  const { container, close } = await mount()
  const toggle = container.querySelector<HTMLButtonElement>('[data-row="3"]')!
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  expect(container.textContent).not.toContain('builtin.zoom')
  expect(container.querySelector('[role="group"]')).toBeNull()

  await act(async () => toggle.click())
  expect(toggle.getAttribute('aria-expanded')).toBe('true')
  const panel = container.querySelector('[role="group"]')!
  expect(toggle.getAttribute('aria-controls')).toBe(panel.id)
  expect(panel.textContent).toContain('Id')
  expect(panel.textContent).toContain('builtin.zoom')
  // The panel is not one of the three rows.
  expect(container.querySelectorAll('[data-row]')).toHaveLength(3)

  await act(async () => toggle.click())
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  expect(container.querySelector('[role="group"]')).toBeNull()
  await close()
})

it('renders extra children (such as a dialog) outside the rows', async () => {
  const { container, close } = await mount()
  expect(container.querySelector('[data-extra]')).toBeTruthy()
  expect(container.querySelector('[data-extra]')?.hasAttribute('data-row')).toBe(false)
  await close()
})
