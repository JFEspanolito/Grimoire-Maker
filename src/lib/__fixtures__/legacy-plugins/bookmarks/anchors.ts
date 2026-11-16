/** A bookmark points at a text block: its position among the document's blocks, plus its opening text. */
export interface BlockAnchor { index: number; excerpt: string }

const BLOCKS = 'p, h1, h2, h3, h4, h5, h6'
const EXCERPT_LENGTH = 80
const REVEAL_ATTEMPTS = 40
const REVEAL_INTERVAL_MS = 50

const blocksOf = (editor: Element) =>
  Array.from(editor.querySelectorAll<HTMLElement>(BLOCKS)).filter(block => !block.closest('[data-editor-only]'))
const excerptOf = (block: Element) => (block.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, EXCERPT_LENGTH)

/** The block under an event target, or null for anything that is not bookmarkable text. */
export function describeBlock(target: EventTarget | null): BlockAnchor | null {
  const block = target instanceof Element ? target.closest<HTMLElement>(BLOCKS) : null
  const editor = block?.closest('.ProseMirror')
  if (!block || !editor) return null
  const excerpt = excerptOf(block)
  const index = blocksOf(editor).indexOf(block)
  return excerpt && index >= 0 ? { index, excerpt } : null
}

/** Edits move blocks around, so the stored position is only a hint that the text must confirm. */
export function locateBlock(editor: Element, anchor: BlockAnchor): HTMLElement | null {
  const blocks = blocksOf(editor)
  const hinted = blocks[anchor.index]
  if (hinted && excerptOf(hinted) === anchor.excerpt) return hinted
  return blocks.find(block => excerptOf(block) === anchor.excerpt) ?? null
}

/** Waits for the focused editor to show the document, then scrolls to the block and flashes it. */
export async function revealBlock(anchor: BlockAnchor): Promise<boolean> {
  for (let attempt = 0; attempt < REVEAL_ATTEMPTS; attempt++) {
    const editor = document.querySelector('[data-active-editor="true"] .ProseMirror')
    const block = editor ? locateBlock(editor, anchor) : null
    if (block) {
      block.scrollIntoView({ block: 'center', behavior: 'smooth' })
      // An animation leaves the editor's DOM untouched, unlike toggling a class on its blocks.
      block.animate?.([{ backgroundColor: 'rgba(207, 179, 124, 0.55)' }, { backgroundColor: 'rgba(207, 179, 124, 0)' }], { duration: 1600 })
      return true
    }
    await new Promise(resolve => setTimeout(resolve, REVEAL_INTERVAL_MS))
  }
  return false
}
