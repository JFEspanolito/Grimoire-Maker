import { afterEach, expect, it, vi } from 'vitest'
import { alignSections, isSectionContentMutation } from './sectionLayout'

afterEach(() => vi.restoreAllMocks())

it('ignores measurement probes but still observes real content edits', () => {
  const [{ flow }] = layout(30)
  const observer = new MutationObserver(() => undefined)
  observer.observe(flow, { childList: true, characterData: true, subtree: true })
  alignSections(flow)
  const probes = observer.takeRecords()
  expect(probes.length).toBeGreaterThan(0)
  expect(probes.some(isSectionContentMutation)).toBe(false)
  flow.querySelector('section')!.append(document.createTextNode('writing'))
  expect(observer.takeRecords().some(isSectionContentMutation)).toBe(true)
  observer.disconnect()
})

/** Rows are 100 tall with a 20 gap; a section reports the height in its data-height attribute. */
function layout(...heights: number[]) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const height = this.style.height === 'var(--content-height)' ? 100 : this.style.height === 'var(--row-gap)' ? 20 : Number(this.dataset.height ?? 0)
    return { height } as DOMRect
  })
  const flow = document.createElement('div')
  flow.innerHTML = heights.map((height) => `<section class="grimoire-section" data-height="${height}"></section>`).join('')
  return Array.from(flow.querySelectorAll<HTMLElement>('.grimoire-section')).map((section) => ({ section, flow }))
}

it('pads each section to whole sheets so the next one starts on a new page', () => {
  const sections = layout(30, 100, 105, 220, 340)
  alignSections(sections[0].flow)
  expect(sections.map(({ section }) => section.style.minHeight)).toEqual([
    'calc(1 * var(--content-height) + 0 * var(--row-gap))',
    'calc(1 * var(--content-height) + 0 * var(--row-gap))',
    'calc(2 * var(--content-height) + 1 * var(--row-gap))',
    'calc(2 * var(--content-height) + 1 * var(--row-gap))',
    'calc(3 * var(--content-height) + 2 * var(--row-gap))',
  ])
})

it('lets a section shrink again when its text shrinks, and leaves a hidden layout alone', () => {
  const [{ section, flow }] = layout(250)
  alignSections(flow)
  expect(section.style.minHeight).toContain('calc(3 ')
  section.dataset.height = '90'
  alignSections(flow)
  expect(section.style.minHeight).toContain('calc(1 ')
  vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({ height: 0 } as DOMRect)
  section.style.minHeight = '7px'
  alignSections(flow)
  expect(section.style.minHeight).toBe('7px')
})
