import { describe, expect, it } from 'vitest'
import { classifyFile } from './filePreview'

describe('file preview classification', () => {
  it.each([
    ['H:/Draft/Notes.MD', 'markdown'], ['H:/Research/MAP.PNG', 'image'],
    ['photo.jpeg', 'image'], ['vector.svg', 'image'], ['manual.PDF', 'pdf'],
    ['notes.docx', 'word'], ['legacy.doc', 'word'], ['archive.zip', 'unsupported'],
    ['folder.pdf/readme', 'unsupported'],
  ])('classifies %s as %s', (path, kind) => expect(classifyFile(path)).toBe(kind))
})
