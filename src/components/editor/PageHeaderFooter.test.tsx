import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { PageHeaderFooter } from './PageHeaderFooter'

it('renders divider-only headers and footers with independent sides and one shared color', () => {
  const slots = { left: '', center: '', right: '' }
  const layout = { header: slots, footer: slots, divider: {
    header: { top: false, bottom: true, left: false, right: true },
    footer: { top: true, bottom: false, left: true, right: false }, color: '#abcdef',
  } }
  const host = document.createElement('div')
  host.innerHTML = renderToStaticMarkup(<PageHeaderFooter layout={layout} context={{ page: 1, pages: 2 }} marginMm={15} />)
  const header = host.querySelector<HTMLElement>('.grimoire-page-text-header')!
  const footer = host.querySelector<HTMLElement>('.grimoire-page-text-footer')!
  expect(header).not.toBeNull()
  expect(header.style.borderBottom).toBe('1px solid rgb(171, 205, 239)')
  expect(header.style.borderRight).toBe(header.style.borderBottom)
  expect(footer.style.borderTop).toBe(header.style.borderBottom)
  expect(footer.style.borderLeft).toBe(header.style.borderBottom)
  expect(header.style.borderTopWidth).not.toBe('1px')
  expect(footer.style.borderBottomWidth).not.toBe('1px')
  expect(renderToStaticMarkup(<PageHeaderFooter layout={{ header: slots, footer: slots }} context={{ page: 1, pages: 1 }} marginMm={15} />)).toBe('')
})
