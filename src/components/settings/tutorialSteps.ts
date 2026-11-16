export interface TourStep {
  title: string
  selectors: readonly string[]
  placement: 'right' | 'center' | 'bottom' | 'bottom-end' | 'left' | 'top'
  description: string
  usage: string
}

export const TUTORIAL_STEPS: readonly TourStep[] = [
  {
    title: 'Project Files & Templates',
    selectors: ['[data-tour="project-sidebar"] > :first-child', '[data-tour="project-sidebar"]', 'aside'],
    placement: 'right',
    description: 'Organize your manual in Draft, Research, and Trash, and start new sections or books from ready-made Templates.',
    usage: 'Use + File or + Folder to create content, drag files between folders, open images/PDF/DOCX in read-only preview tabs, or apply a Template.',
  },
  {
    title: 'Git · Source Control',
    selectors: ['[data-tour="git-source-control"]', '#source-control-panel'],
    placement: 'right',
    description: 'Track local history, inspect modified files, stage changes, and create commits without leaving your workspace.',
    usage: 'Open Git · Source control at the bottom-left to review diffs, stage or commit changes, and configure auto-commit intervals in Settings → Preferences.',
  },
  {
    title: 'Tabs, Split View & Page Editor',
    selectors: ['[data-tour="editor-workspace"]', 'main'],
    placement: 'center',
    description: 'Write in Markdown directly on physical sheets with independent multi-tab editing, side-by-side Split View, and 1, 2, or 3 column layouts.',
    usage: 'Click any sheet to start writing, open multiple documents in tabs, or use View → Split View and Columns to compare and lay out chapters.',
  },
  {
    title: 'Integrated Terminal',
    selectors: ['#terminal-panel', '[aria-label="Terminal"]'],
    placement: 'top',
    description: 'Run shell commands, scripts, or Git CLI tools directly inside your active project folder.',
    usage: 'Toggle the panel from View → Terminal, run commands in your workspace, and use the header buttons to clear or hide it when not needed.',
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
    title: 'Snippets',
    selectors: ['[data-tour="snippets-sidebar"] > :first-child', '[data-tour="snippets-sidebar"]'],
    placement: 'left',
    description: 'Insert reusable RPG blocks inside movable Content Boxes—including Character Sheets, Statblocks, Read-aloud boxes, and encounter or loot tables.',
    usage: 'Drag any snippet from the right-hand Snippets panel onto a page, or double-click it to insert at your cursor.',
  },
  {
    title: 'Properties',
    selectors: ['[data-tour="properties-panel"]', '#properties-panel'],
    placement: 'left',
    description: 'Configure global book credits (title, authors, artists) and per-page layout overrides such as column count.',
    usage: 'Use Properties at the bottom-right to edit book metadata, switch the active page between 1, 2, or 3 columns, or export the page as a snippet.',
  },
  {
    title: 'Themes, Mods & Export PDF',
    selectors: ['[aria-label="Application menu"]'],
    placement: 'bottom',
    description: 'Customize visual themes, manage installed mod packages, configure auto-save intervals, and publish your finished manual to PDF.',
    usage: 'Open Settings → Preferences or Mod Manager to customize themes and mods, and select File → Export PDF… to generate and open your print-ready PDF.',
  },
]
