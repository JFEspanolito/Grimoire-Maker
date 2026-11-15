import { expect, it } from 'vitest'
import { assetFolder, imageReference, isImageFile, normalizePath, relativePath } from './assetPaths'

it('compares Windows drive and UNC segments without changing their spelling', () => {
  expect(relativePath('c:/Book/Draft', 'C:/BOOK/Assets/Map.png')).toBe('../Assets/Map.png')
  expect(assetFolder('c:/BOOK/Draft/Part/Scene.md', 'C:/Book')).toBe('C:/Book/Assets/Part')
  expect(relativePath('//Server/Share/Book/Draft', '//server/share/book/Assets/Map.png')).toBe('../Assets/Map.png')
  expect(assetFolder('/book/Draft/a.md', '/Book')).toBeNull()
})

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

it('references an existing project image from a document without copying it', () => {
  expect(imageReference('/w/Draft/Chapter 1/Scene.md', '/w/Assets/Chapter 1/map.png')).toBe('../../Assets/Chapter 1/map.png')
  expect(imageReference('C:\\w\\Draft\\Scene.md', 'C:/w/Assets/map.png')).toBe('../Assets/map.png')
  expect(['a.PNG', 'b.jpeg', 'c.svg', 'd.md', 'e.pdf'].map(isImageFile)).toEqual([true, true, true, false, false])
})
