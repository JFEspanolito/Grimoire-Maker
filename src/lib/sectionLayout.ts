/**
 * Sections flow in their own column rows, so each one is padded to whole sheets and the next
 * starts on a fresh page. Heights are compared with probes measured the same way, which keeps
 * the result right under display zoom without converting units.
 */
export function isSectionContentMutation(record: MutationRecord): boolean {
  if (record.type !== 'childList') return true
  return [...record.addedNodes, ...record.removedNodes].some(node =>
    !(node instanceof HTMLElement && node.hasAttribute('data-section-layout-probe')))
}

/** Pads every section to whole sheets and returns how many sheets they fill (0 when nothing could be measured). */
export function alignSections(flow: HTMLElement): number {
  const sections = Array.from(flow.querySelectorAll<HTMLElement>('.grimoire-section'))
  if (!sections.length) return 0
  const probe = (height: string) => {
    const element = document.createElement('div')
    element.setAttribute('data-section-layout-probe', '')
    element.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;width:0;height:${height}`
    flow.append(element)
    const measured = element.getBoundingClientRect().height
    element.remove()
    return measured
  }
  // Clearing the padding shrinks the page for a moment; the browser clamps the scroll position
  // on that layout and never gives it back, which reads as the view jumping while typing.
  const scrolls: [Element, number][] = []
  for (let element: Element | null = flow; element; element = element.parentElement) {
    if (element.scrollTop) scrolls.push([element, element.scrollTop])
  }
  // A spread breaks the stack into one fragment per sheet, and anything measured there is cut at the
  // break: the "one row" probe came back shorter than a row, so every section counted as two rows (a
  // blank sheet after it). Measure with the breaking switched off, exactly as in single page view.
  const spread = flow.closest<HTMLElement>('[data-page-layout="spreads"]')
  const columns = ['column-count', 'column-height', 'column-wrap']
  if (spread) for (const [property, value] of [['column-count', '1'], ['column-height', 'auto'], ['column-wrap', 'nowrap']]) spread.style.setProperty(property, value)
  let content = 0
  let gap = 0
  let natural: number[] = []
  try {
    content = probe('var(--content-height)')
    gap = probe('var(--row-gap)')
    if (content > 0) {
      for (const section of sections) section.style.minHeight = ''
      natural = sections.map((section) => (section.getBoundingClientRect().height + gap) / (content + gap))
    }
  } finally {
    if (spread) for (const property of columns) spread.style.removeProperty(property)
  }
  if (!(content > 0)) return 0
  let total = 0
  sections.forEach((section, index) => {
    const rows = Math.max(1, Math.ceil(natural[index] - 0.01))
    total += rows
    section.style.minHeight = `calc(${rows} * var(--content-height) + ${rows - 1} * var(--row-gap))`
  })
  for (const [element, top] of scrolls) if (element.scrollTop !== top) element.scrollTop = top
  return total
}
