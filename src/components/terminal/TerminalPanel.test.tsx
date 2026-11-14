import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { TerminalPanel } from './TerminalPanel'
import { DEFAULT_PANELS, useSettingsStore } from '../../stores/settingsStore'

let root: Root | null = null

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  if (!window.matchMedia) {
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  }
})
afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = null
  useSettingsStore.setState({ panels: DEFAULT_PANELS })
})

describe('TerminalPanel', () => {
  it('renders header, title, badge and controls', async () => {
    const container = document.createElement('div')
    root = createRoot(container)
    await act(async () => root?.render(<TerminalPanel workspace="/mock/path" />))

    expect(container.querySelector('[aria-label="Terminal"]')).not.toBeNull()
    expect(container.textContent).toContain('Terminal')

    const clearBtn = container.querySelector<HTMLButtonElement>('[aria-label="Clear terminal"]')
    const closeBtn = container.querySelector<HTMLButtonElement>('[aria-label="Close terminal panel"]')
    expect(clearBtn).not.toBeNull()
    expect(closeBtn).not.toBeNull()

    // Test close button
    useSettingsStore.setState({ panels: { ...DEFAULT_PANELS, bottomPanel: true } })
    await act(async () => closeBtn?.click())
    expect(useSettingsStore.getState().panels.bottomPanel).toBe(false)
  })

  it('resizes with pointer events on the top handle', async () => {
    const container = document.createElement('div')
    root = createRoot(container)
    await act(async () => root?.render(<TerminalPanel workspace={null} />))

    const section = container.querySelector<HTMLElement>('#terminal-panel')!
    const handle = container.querySelector<HTMLElement>('[aria-label="Resize terminal panel"]')!
    expect(section.style.height).toBe('240px')

    const pointer = (type: string, y: number) => {
      const event = new MouseEvent(type, { bubbles: true, clientY: y, button: 0 })
      Object.defineProperty(event, 'pointerId', { value: 1 })
      handle.dispatchEvent(event)
    }

    await act(async () => pointer('pointerdown', 300))
    await act(async () => pointer('pointermove', 260)) // dragged up by 40px -> height increases
    await act(async () => pointer('pointerup', 260))

    expect(section.style.height).toBe('280px')
  })
})
