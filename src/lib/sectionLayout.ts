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

export function alignSections(flow: HTMLElement): void {
  const sections = Array.from(flow.querySelectorAll<HTMLElement>('.grimoire-section'))
  if (!sections.length) return
  const probe = (height: string) => {
    const element = document.createElement('div')
    element.setAttribute('data-section-layout-probe', '')
    element.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;width:0;height:${height}`
    flow.append(element)
    const measured = element.getBoundingClientRect().height
    element.remove()
    return measured
  }
  const content = probe('var(--content-height)')
  const gap = probe('var(--row-gap)')
  if (!(content > 0)) return
  for (const section of sections) section.style.minHeight = ''
  const natural = sections.map((section) => section.getBoundingClientRect().height)
  sections.forEach((section, index) => {
    const rows = Math.max(1, Math.ceil((natural[index] + gap) / (content + gap) - 0.01))
    section.style.minHeight = `calc(${rows} * var(--content-height) + ${rows - 1} * var(--row-gap))`
  })
}
