import type { Editor } from '@tiptap/react'

export interface PageRef {
  /** 1-based sheet the caret is on. */
  sheet: number
  /** Position before the first block on that sheet; null when the sheet shows no text. */
  start: number | null
  /** Position before the first block on the following sheet, if any. */
  next: number | null
}

const SHEET = '[data-editor-sheet]'
const overlaps = (a: DOMRect, b: DOMRect) => a.bottom > b.top + 1 && a.top < b.bottom - 1 && a.right > b.left + 1 && a.left < b.right - 1

/** The sheet under the caret. Cheap enough to ask on every selection change. */
export function currentSheet(editor: Editor): { element: HTMLElement; number: number } | null {
  const stack = editor.view.dom.closest('[data-editor-stack]')
  const sheets = Array.from(stack?.querySelectorAll<HTMLElement>(SHEET) ?? [])
  if (!sheets.length) return null
  let caret: { left: number; top: number; bottom: number }
  try { caret = editor.view.coordsAtPos(editor.state.selection.from) } catch { return null }
  const x = caret.left + 1
  const y = (caret.top + caret.bottom) / 2
  const rects = sheets.map(sheet => sheet.getBoundingClientRect())
  const inside = rects.findIndex(rect => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)
  const nearest = inside >= 0 ? inside : rects.reduce((best, rect, index) =>
    Math.abs(y - (rect.top + rect.bottom) / 2) < Math.abs(y - (rects[best].top + rects[best].bottom) / 2) ? index : best, 0)
  return { element: sheets[nearest], number: Number(sheets[nearest].dataset.editorSheet) || nearest + 1 }
}

/** Every top-level block of every section with its position and rendered boxes. */
function blocks(editor: Editor): { pos: number; rects: DOMRect[] }[] {
  const found: { pos: number; rects: DOMRect[] }[] = []
  editor.state.doc.forEach((section, sectionOffset) => section.forEach((_block, blockOffset) => {
    const pos = sectionOffset + 1 + blockOffset
    const dom = editor.view.nodeDOM(pos)
    if (!(dom instanceof HTMLElement)) return
    // A node view's wrapper can have no box of its own; its first child then stands in for it.
    const own = Array.from(dom.getClientRects())
    const rects = own.length ? own : Array.from(dom.firstElementChild?.getClientRects() ?? [])
    found.push({ pos, rects })
  }))
  return found
}

/**
 * Where the caret's page starts and where the next one does. A block that begins on an earlier sheet but
 * runs onto this one counts as the page's first block: text is never cut in two to fit a page.
 */
export function currentPage(editor: Editor): PageRef | null {
  const sheet = currentSheet(editor)
  if (!sheet) return null
  const all = blocks(editor)
  const firstOn = (element: Element | undefined) => {
    if (!element) return null
    const area = element.getBoundingClientRect()
    return all.find(block => block.rects.some(rect => overlaps(rect, area)))?.pos ?? null
  }
  const sheets = Array.from(editor.view.dom.closest('[data-editor-stack]')?.querySelectorAll(SHEET) ?? [])
  const start = firstOn(sheet.element)
  const following = firstOn(sheets[sheets.indexOf(sheet.element) + 1])
  return { sheet: sheet.number, start, next: following !== null && start !== null && following > start ? following : null }
}
