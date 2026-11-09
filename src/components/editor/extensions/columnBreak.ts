import { Node } from '@tiptap/react'

declare module '@tiptap/react' {
  interface Commands<ReturnType> {
    columnBreak: {
      insertColumnBreak: () => ReturnType
    }
  }
}

/**
 * A column break forces following text to the top of the next column within the same page
 * without needing empty paragraph spacers.
 */
export const ColumnBreak = Node.create({
  name: 'columnBreak',
  group: 'block',
  selectable: true,
  draggable: false,
  parseHTML() {
    return [{ tag: 'div[data-type="column-break"]' }]
  },
  renderHTML() {
    return ['div', { 'data-type': 'column-break', class: 'grimoire-column-break' }]
  },
  addCommands() {
    return {
      insertColumnBreak: () => ({ chain }) => {
        return chain().insertContent({ type: 'columnBreak' }).run()
      },
    }
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: { write(text: string): void; closeBlock(node: unknown): void }, node: unknown) {
          state.write('<div data-type="column-break"></div>')
          state.closeBlock(node)
        },
        parse: {},
      },
    }
  },
})
