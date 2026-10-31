# Quotes Plugin

The Quotes plugin allows scholars and writers to extract citations from research sources and active drafts, manage bibliographic metadata, and insert formatted quotations into their manuscript with automatic bibliography synchronization in `Draft/References.md`.

## Included Files

- `index.md` — Plugin metadata descriptor.
- `quotes.tsx` — Plugin entry point registering toolbar control and context action.
- `quotesStore.ts` — Persistent Zustand store managing quotations in `.grimoire-plugin-builtin.quotes.json`.
- `referencesManager.ts` — Synchronizes quotations with `Draft/References.md`.
- `QuotesButton.tsx` — Toolbar panel and dialog interface for viewing, editing, and dragging quotes.
- `Quotes.module.css` — Modern styling for the quotes drawer and cards.
