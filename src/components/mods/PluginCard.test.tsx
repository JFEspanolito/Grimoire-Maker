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

it('is made of two rows (name and status, then the description) with the actions and a Details link in a right column', async () => {
  const { container, close } = await mount()
  const rows = [...container.querySelectorAll('[data-row]')]
  expect(rows.map((row) => row.getAttribute('data-row'))).toEqual(['1', '2'])
  expect(rows[0].textContent).toContain('Zoom')
  expect(rows[0].textContent).toContain('v2.0.0')
  expect(rows[0].textContent).toContain('On')
  expect(rows[0].textContent).not.toContain('Built in')
  expect(rows[0].querySelector('strong')?.textContent).toBe('Zoom')
  expect(rows[1].textContent).toBe('Change the zoom of the editor.')
  const buttons = [...container.querySelectorAll('button')]
  expect(buttons.map((button) => button.textContent)).toEqual(['Turn off', 'Details'])
  // The Details link comes right after the action button, so it sits below it in the right column.
  expect(container.querySelector('[class*="link"]')).toBe(buttons[1])
  await close()
})

it('keeps the details hidden until the toggle opens them, and reports the state with aria-expanded', async () => {
  const { container, close } = await mount()
  const toggle = container.querySelector<HTMLButtonElement>('[aria-label="Details of Zoom"]')!
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  expect(container.textContent).not.toContain('builtin.zoom')
  expect(container.querySelector('[role="group"]')).toBeNull()

  await act(async () => toggle.click())
  expect(toggle.getAttribute('aria-expanded')).toBe('true')
  const panel = container.querySelector('[role="group"]')!
  expect(toggle.getAttribute('aria-controls')).toBe(panel.id)
  expect(panel.textContent).toContain('Id')
  expect(panel.textContent).toContain('builtin.zoom')
  // The origin lives here instead of in a badge on the row.
  expect(panel.textContent).toContain('Source Built in')
  // The panel is not one of the rows.
  expect(container.querySelectorAll('[data-row]')).toHaveLength(2)

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
