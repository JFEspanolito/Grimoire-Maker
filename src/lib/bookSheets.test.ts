import { expect, it } from 'vitest'
import { renumberSheets } from './bookSheets'
import type { PageRequest } from './exportPdf'

const request: PageRequest = {
  pageSize: 'a4', columns: 1, theme: 'parchment', bleedMm: 0, marginMm: 15,
  headerFooter: { header: { left: '', center: '', right: '' }, footer: { left: '', center: '{page}/{pages}', right: '' } },
  pageText: { book: 'Book' },
}
const sheet = () => '<div class="native-print-sheet"><div data-theme-page-text><div>1/1</div></div></div><style data-native-print-style>@page{}</style>'

it('numbers the sheets of every document as one book and keeps a single page rule', () => {
  const target = document.createElement('div')
  target.innerHTML = sheet() + sheet() + sheet()
  expect(renumberSheets(request, target)).toBe(3)
  expect(Array.from(target.querySelectorAll('[data-theme-page-text]'), (text) => text.textContent)).toEqual(['1/3', '2/3', '3/3'])
  expect(Array.from(target.querySelectorAll<HTMLElement>('.native-print-sheet'), (item) => item.dataset.printSheet)).toEqual(['1', '2', '3'])
  expect(target.querySelectorAll('style[data-native-print-style]')).toHaveLength(1)
})

it('leaves sheets without header or footer alone', () => {
  const target = document.createElement('div')
  target.innerHTML = '<div class="native-print-sheet"></div><div class="native-print-sheet"></div>'
  expect(renumberSheets({ ...request, headerFooter: undefined }, target)).toBe(2)
})
