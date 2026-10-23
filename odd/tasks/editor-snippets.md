Objective: spec module 4.2 (preconfigured snippets), after 4.1. Branch: main (commit per task). Delivery: ask-on-risk, no PR. Test runner: vitest (`pnpm test`); also `tsc -p tsconfig.app.json --noEmit`, `oxlint src`, `vite build`.

## Specs
- S1: "Tablas de Encuentros / Botín: Tablas preformateadas listas para completar datos." Tables must be editable (add/remove rows and columns) and survive the Markdown round trip.
- S2: "Hojas de Personaje: Plantillas de fichas con rejillas de atributos editables."
- S3: "Panel lateral de componentes preconstruidos listos para arrastrar al documento" with the four kinds: character sheets, statblocks, read-aloud boxes, encounter/loot tables (existing: statblock, read-aloud).

## Tasks
- T1 | S1 | inline | status: done (not seen in the running app) | commit: 40c89e4 | Table support: extension, styling, row/column controls, Markdown round-trip tests
- T2 | S1,S3 | inline | status: done (not seen in the running app) | commit: 97c8959 | Encounter table and loot table snippets in the palette
- T3 | S2,S3 | inline | status: done (not seen in the running app) | commit: see git log (feat(snippets): character sheet) | Character sheet block with attribute grid, palette entry

## Log
- L1 (2026-10-22): "sí sigue" (continue with the next module after 4.1; module 2 = snippets: only 2 of 4 snippet kinds existed)
- L2 route declaration: all tasks inline; sequential, same palette/editor files, no Writer trigger.
- L3: T1 evidence: RED = tables.test.ts could not resolve ./tables; GREEN = 8 vitest tests (GFM table round trip + idempotent re-save, table inside a statblock block, buildTable shape and reload). tiptap-markdown writes a trailing blank line after a table; the test checks re-saving does not grow it.
- L4: T2 evidence: RED = snippets.test.ts could not resolve ./snippets; GREEN = 15 vitest tests total (every catalog snippet inserts and serializes; encounter table is d6 numbered 1-6; loot table d100 ranges 01-00). Palette now groups snippets (Blocks, Tables) from components/snippets/snippets.ts and refuses inserts outside Edit view.
- L5: T3 evidence: RED = 2 character sheet tests failing (no snippet, no node); GREEN = 18 vitest tests total. Character sheet is a `characterSheet` block (stored as <div data-type="character-sheet">) holding an attribute grid (STR..CHA, default 10), a combat grid (AC/HP/Speed/Initiative) and editable lists, so every value is an editable table cell and edits survive save/reload. buildTable now takes `values[row][col]`.
- L6: all three tasks done. Spec 4.2 covered: character sheets, statblocks, read-aloud boxes, encounter/loot tables. Not covered: dragging to reorder blocks within the page; none of this was seen in a running desktop window.
