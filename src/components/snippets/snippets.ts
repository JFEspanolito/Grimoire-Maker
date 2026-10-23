import { READ_ALOUD_TEMPLATE, STATBLOCK_TEMPLATE } from '../editor/extensions/blocks'
import { buildTable } from '../editor/extensions/tables'

export type SnippetGroup = 'Blocks' | 'Tables'

export interface Snippet {
  id: string
  label: string
  group: SnippetGroup
  /** Editor JSON (one node or several) inserted at the drop point or cursor. */
  node: object | object[]
}

const heading = (text: string): object => ({
  type: 'heading',
  attrs: { level: 3 },
  content: [{ type: 'text', text }],
})

export const SNIPPETS: Snippet[] = [
  { id: 'statblock', label: 'Statblock', group: 'Blocks', node: STATBLOCK_TEMPLATE },
  { id: 'read-aloud', label: 'Read-aloud box', group: 'Blocks', node: READ_ALOUD_TEMPLATE },
  {
    id: 'encounter-table',
    label: 'Encounter table (d6)',
    group: 'Tables',
    node: [
      heading('Random Encounters'),
      buildTable(['d6', 'Encounter', 'Notes'], 6, ['1', '2', '3', '4', '5', '6']),
    ],
  },
  {
    id: 'loot-table',
    label: 'Loot table (d100)',
    group: 'Tables',
    node: [
      heading('Treasure'),
      buildTable(['d100', 'Treasure', 'Value'], 4, ['01–50', '51–80', '81–95', '96–00']),
    ],
  },
]

export function findSnippet(id: string): Snippet {
  const snippet = SNIPPETS.find((s) => s.id === id)
  if (!snippet) throw new Error(`Unknown snippet "${id}"`)
  return snippet
}
