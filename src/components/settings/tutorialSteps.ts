export interface TourStep {
  title: string
  selectors: readonly string[]
  placement: 'right' | 'center' | 'bottom' | 'bottom-end' | 'left'
  description: string
  usage: string
}

export const TUTORIAL_STEPS: readonly TourStep[] = [
  {
    title: 'Project Files, Templates & Git',
    selectors: ['[data-tour="project-sidebar"]', 'aside'],
    placement: 'right',
    description: 'Organize your manual in Draft, Research, and Trash, start from ready-made book Templates, and record local history with Git · Source control.',
    usage: 'Use + File or + Folder to create content, drag files between folders, open images/PDF/DOCX in read-only preview tabs, or commit changes in the Git panel.',
  },
  {
    title: 'Tabs, Split View & Page Editor',
    selectors: ['[data-tour="editor-workspace"]', 'main'],
    placement: 'center',
    description: 'Write in Markdown directly on physical sheets with independent multi-tab editing, side-by-side Split View, and 1 or 2 column layouts.',
    usage: 'Click any sheet to start writing, open multiple documents in tabs, or use View → Split View and Columns to compare and lay out chapters.',
  },
  {
    title: 'Formatting, Images & Alignment Guides',
    selectors: ['[role="toolbar"][aria-label="Formatting"]'],
    placement: 'bottom',
    description: 'Apply headings, lists, and emphasis, insert illustrations with text wrap or free placement, and add millimetre alignment guides.',
    usage: 'Click Image to import illustrations (use Push text to wrap paragraphs or Over text to drag across pages) and open Guides to add + Row or + Column lines.',
  },
  {
    title: 'Page View, Zoom & Print Ruler',
    selectors: ['[role="group"][aria-label="Editor tools"]'],
    placement: 'bottom-end',
    description: 'Inspect your book as single sheets or open-book facing spreads, scale the workspace, and verify physical margins and bleed.',
    usage: 'Switch Page view between Single page and Spread, change Zoom (or press Ctrl + mouse wheel), and toggle Ruler to inspect page measurements.',
  },
  {
    title: 'Snippets & Properties',
    selectors: ['[data-tour="snippets-sidebar"]'],
    placement: 'left',
    description: 'Insert reusable RPG blocks inside movable Content Boxes and configure global book credits or per-page layout overrides.',
    usage: 'Drag Snippets (Character Sheet, Statblock, Read-aloud, d6/d100 tables) onto a page, and edit book title, authors, artists, or page columns in Properties.',
  },
  {
    title: 'Themes, Mods & Export PDF',
    selectors: ['[aria-label="Application menu"]'],
    placement: 'bottom',
    description: 'Customize visual themes, manage installed mod packages, configure auto-save intervals, and publish your finished manual to PDF.',
    usage: 'Open Settings → Preferences or Mod Manager to customize themes and mods, and select File → Export PDF… to generate and open your print-ready PDF.',
  },
]
