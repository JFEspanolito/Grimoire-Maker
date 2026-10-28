import { READ_ALOUD_TEMPLATE, STATBLOCK_TEMPLATE } from '../editor/extensions/blocks'
import { buildTable } from '../editor/extensions/tables'

export const SNIPPET_GROUPS = ['Rol Adventures'] as const
export type SnippetGroup = (typeof SNIPPET_GROUPS)[number]

export interface Snippet {
  id: string
  label: string
  group: SnippetGroup
  subgroup?: string
  /** Editor JSON (one node or several) inserted at the drop point or cursor. */
  node: object | object[]
}

const heading = (text: string): object => ({
  type: 'heading',
  attrs: { level: 3 },
  content: [{ type: 'text', text }],
})

const text = (value: string): object => ({ type: 'text', text: value })
const paragraph = (value: string): object => ({ type: 'paragraph', content: [text(value)] })
const subheading = (value: string): object => ({
  type: 'heading',
  attrs: { level: 4 },
  content: [text(value)],
})
const bullets = (items: string[]): object => ({
  type: 'bulletList',
  content: items.map((item) => ({ type: 'listItem', content: [paragraph(item)] })),
})

/** Both grids are real tables, so every cell is editable and the sheet stays plain Markdown. */
const CHARACTER_SHEET = {
  type: 'characterSheet',
  content: [
    heading('Character Name'),
    paragraph('Class · Level · Background · Player'),
    buildTable(['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'], 1, [['10', '10', '10', '10', '10', '10']]),
    buildTable(['AC', 'HP', 'Speed', 'Initiative'], 1, [['10', '10', '30 ft.', '+0']]),
    subheading('Skills & Proficiencies'),
    bullets(['Skill or proficiency']),
    subheading('Equipment'),
    bullets(['Item']),
    subheading('Notes'),
    paragraph('Background, bonds and goals…'),
  ],
}

export const SNIPPETS: Snippet[] = [
  { id: 'character-sheet', label: 'Character Sheet (D&D)', group: 'Rol Adventures', node: CHARACTER_SHEET },
  { id: 'statblock', label: 'Statblock (D&D)', group: 'Rol Adventures', node: STATBLOCK_TEMPLATE },
  { id: 'read-aloud', label: 'Read-aloud box', group: 'Rol Adventures', node: READ_ALOUD_TEMPLATE },
  {
    id: 'encounter-table',
    label: 'Encounter Table (d6)',
    group: 'Rol Adventures',
    node: [
      heading('Random Encounters'),
      buildTable(['d6', 'Encounter', 'Notes'], 6, [['1'], ['2'], ['3'], ['4'], ['5'], ['6']]),
    ],
  },
  {
    id: 'loot-table',
    label: 'Loot Table (d100)',
    group: 'Rol Adventures',
    node: [
      heading('Treasure'),
      buildTable(['d100', 'Treasure', 'Value'], 4, [['01–50'], ['51–80'], ['81–95'], ['96–00']]),
    ],
  },
]

export function findSnippet(id: string): Snippet {
  const snippet = SNIPPETS.find((s) => s.id === id)
  if (!snippet) throw new Error(`Unknown snippet "${id}"`)
  return snippet
}
