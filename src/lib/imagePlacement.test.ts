import { expect, it } from 'vitest'
import { positionImageOnPage } from './imagePlacement'

it('moves an image in millimetres and clamps it within the physical sheet', () => {
  const page = { left: 0, top: 0, width: 420, height: 594 }
  const image = { left: 60, top: 80, width: 80, height: 100 }
  expect(positionImageOnPage(page, image, 210, 297, 40, 60)).toEqual({ xMm: 50, yMm: 70 })
  expect(positionImageOnPage(page, image, 210, 297, 1000, 1000)).toEqual({ xMm: 170, yMm: 247 })
  expect(positionImageOnPage(page, image, 210, 297, -1000, -1000)).toEqual({ xMm: 0, yMm: 0 })
})
