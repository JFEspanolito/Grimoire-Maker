import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { describe, expect, it, vi, beforeEach, afterEach, beforeAll } from 'vitest'
import { HorizontalRuler } from './HorizontalRuler'
import { useSettingsStore } from '../../stores/settingsStore'
import { GUIDE_AXIS } from '../../types/ruler'

let root: Root | null = null
let container: HTMLDivElement | null = null

beforeAll(() => Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true))

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  useSettingsStore.setState({
    rulerGuides: [],
    marginMm: 15,
    pageSize: 'a4',
  })
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  container = null
  root = null
})

describe('HorizontalRuler', () => {
  it('renders ruler with correct width and margin handles', async () => {
    await act(async () => {
      root?.render(<HorizontalRuler widthMm={210} marginMm={15} />)
    })

    const leftHandle = container!.querySelector('[role="slider"][aria-label="Margen izquierdo"]')
    expect(leftHandle).toBeTruthy()
    expect(leftHandle?.getAttribute('aria-valuenow')).toBe('15')

    const rightHandle = container!.querySelector('[role="slider"][aria-label="Margen derecho"]')
    expect(rightHandle).toBeTruthy()
    expect(rightHandle?.getAttribute('aria-valuenow')).toBe('15')

    const svg = container!.querySelector('svg')
    expect(svg).toBeTruthy()
    expect(svg?.getAttribute('viewBox')).toBe('0 0 210 24')
  })

  it('renders centimeter number labels inside ruler', async () => {
    await act(async () => {
      root?.render(<HorizontalRuler widthMm={210} marginMm={15} />)
    })

    const texts = Array.from(container!.querySelectorAll('text')).map((t) => t.textContent)
    expect(texts).toContain('1')
    expect(texts).toContain('5')
    expect(texts).toContain('10')
    expect(texts).toContain('15')
    expect(texts).toContain('20')
  })

  it('calls onMarginChange when double clicking on margin handle', async () => {
    const onMarginChange = vi.fn()
    await act(async () => {
      root?.render(<HorizontalRuler widthMm={210} marginMm={25} onMarginChange={onMarginChange} />)
    })

    const leftHandle = container!.querySelector('[aria-label="Margen izquierdo"]')!
    await act(async () => {
      leftHandle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })

    expect(onMarginChange).toHaveBeenCalledWith(15)
  })

  it('renders indent slider when editor is provided', async () => {
    const mockEditor = {
      isActive: vi.fn((type) => type === 'paragraph'),
      getAttributes: vi.fn(() => ({ indent: 2 })),
      chain: vi.fn(() => ({
        focus: () => ({
          updateAttributes: () => ({
            run: () => true,
          }),
        }),
      })),
      state: { selection: {} },
    } as any

    await act(async () => {
      root?.render(<HorizontalRuler widthMm={210} marginMm={15} editor={mockEditor} />)
    })

    const indentSlider = container!.querySelector('[aria-label="Sangría de párrafo"]')
    expect(indentSlider).toBeTruthy()
    expect(indentSlider?.getAttribute('aria-valuenow')).toBe('2')
  })

  it('renders column guides without adding guides on accidental ruler click', async () => {
    useSettingsStore.setState({
      rulerGuides: [{ id: 'col-1', axis: GUIDE_AXIS.COLUMN, positionMm: 50 }],
    })

    await act(async () => {
      root?.render(<HorizontalRuler widthMm={210} marginMm={15} />)
    })

    const guideMarker = container!.querySelector('[aria-label="Guía de columna en 50.0 mm"]')
    expect(guideMarker).toBeTruthy()

    const rulerEl = container!.firstElementChild as HTMLElement
    await act(async () => {
      rulerEl.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 105 }))
    })

    // Rulers should not create accidental guides on click
    const guides = useSettingsStore.getState().rulerGuides
    expect(guides.length).toBe(1)
  })

  it('removes a column guide when double clicked on ruler', async () => {
    useSettingsStore.setState({
      rulerGuides: [{ id: 'col-1', axis: GUIDE_AXIS.COLUMN, positionMm: 50 }],
    })

    await act(async () => {
      root?.render(<HorizontalRuler widthMm={210} marginMm={15} />)
    })

    const guideMarker = container!.querySelector('[aria-label="Guía de columna en 50.0 mm"]')!
    await act(async () => {
      guideMarker.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })

    expect(useSettingsStore.getState().rulerGuides.length).toBe(0)
  })
})
