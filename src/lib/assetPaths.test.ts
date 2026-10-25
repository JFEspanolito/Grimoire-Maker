import { expect, it } from 'vitest'
import { assetFolder, normalizePath, relativePath } from './assetPaths'

it('mirrors the document folder under Assets, dropping the Draft section name', () => {
  expect(assetFolder('/w/Draft/Chapter 1/Scene.md', '/w')).toBe('/w/Assets/Chapter 1')
  expect(assetFolder('/w/Draft/Part/Chapter 1/Scene.md', '/w')).toBe('/w/Assets/Part/Chapter 1')
  expect(assetFolder('/w/Draft/Intro.md', '/w')).toBe('/w/Assets')
  expect(assetFolder('/w/Research/Notes/Map.md', '/w')).toBe('/w/Assets/Research/Notes')
  expect(assetFolder('C:\\w\\Draft\\Chapter 1\\Scene.md', 'C:\\w')).toBe('C:/w/Assets/Chapter 1')
})

it('has no project asset folder for loose or foreign documents', () => {
  expect(assetFolder('/w/loose.md', '/w')).toBeNull()
  expect(assetFolder('/elsewhere/Draft/a.md', '/w')).toBeNull()
  expect(assetFolder('/w/Draft/a.md', null)).toBeNull()
})

it('builds and resolves relative paths between the document and its asset', () => {
  const relative = relativePath('/w/Draft/Chapter 1', '/w/Assets/Chapter 1/map.png')
  expect(relative).toBe('../../Assets/Chapter 1/map.png')
  expect(normalizePath(`/w/Draft/Chapter 1/${relative}`)).toBe('/w/Assets/Chapter 1/map.png')
  expect(relativePath('/w/Draft', '/w/Draft/assets/x.png')).toBe('assets/x.png')
})
