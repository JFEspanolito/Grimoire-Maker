import { Node, mergeAttributes } from '@tiptap/react'
import type { Node as PMNode } from '@tiptap/pm/model'

/**
 * Custom block nodes are stored in Markdown as raw HTML blocks
 * (`<div data-type="...">`). tiptap-markdown runs with `html: true`, so they
 * round-trip while the file stays plain text.
 */
function blockNode(name: string, dataType: string, content: string) {
  return Node.create({
    name,
    group: 'block',
    content,
    defining: true,

    parseHTML() {
      return [{ tag: `div[data-type="${dataType}"]` }]
    },

    renderHTML({ HTMLAttributes }) {
      return ['div', mergeAttributes(HTMLAttributes, { 'data-type': dataType, class: dataType }), 0]
    },

    addStorage() {
      return {
        markdown: {
          serialize(state: MarkdownState, node: PMNode) {
            state.write(`<div data-type="${dataType}">\n\n`)
            state.renderContent(node)
            state.write(`\n</div>`)
            state.closeBlock(node)
          },
          parse: {},
        },
      }
    },
  })
}

/** D&D-style statblock: heading + paragraphs/lists. */
export const Statblock = blockNode('statblock', 'statblock', 'block+')

/** Read-aloud / ambience box. */
export const ReadAloud = blockNode('readAloud', 'read-aloud', 'block+')

export const STATBLOCK_TEMPLATE = {
  type: 'statblock',
  content: [
    { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Creature Name' }] },
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'Medium humanoid, neutral · AC 12 · HP 11 · Speed 30 ft.' }],
    },
    {
      type: 'bulletList',
      content: ['STR 10', 'DEX 12', 'CON 10', 'INT 10', 'WIS 10', 'CHA 8'].map((text) => ({
        type: 'listItem',
        content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
      })),
    },
  ],
}

export const READ_ALOUD_TEMPLATE = {
  type: 'readAloud',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'Describe the scene the players walk into…' }],
    },
  ],
}

interface MarkdownState {
  write(text: string): void
  renderContent(node: PMNode): void
  closeBlock(node: PMNode): void
}
