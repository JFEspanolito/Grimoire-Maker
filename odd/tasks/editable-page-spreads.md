# Editable page spreads and matching PDF
Objective: one editable document in page/spread layouts, with matching physical PDF pages.
Route: two parallel behavior units with disjoint surfaces; Vitest and real Chromium/PDF checks. Delivery: local changes, no publishing. Memory mirror pending: runtime session registration unavailable.

## Specs
- S1: "quiero un edit mode donde pueda ver una page o un spread para poder hacer diseño del puto libro" — preserve a single mounted editable document and selection/undo when changing layout.
- S2: "Ambas Page View tienen zoom distinto, debe ser igual al Edit mode de 25% a 300%" — common zoom and page/spread selector to the left of Zoom.
- S3: "View Menú, solo debe mostrar el config según el qué este activo." — remove separate read-only Page View switching; applicable page size/columns remain accessible.
- S4: "el export pdf tienen el mismo bug de 7 paginas cuando son 2 hojas." — use native editor column geometry for PDF; verify actual supplied Welcome.md and JPEG are two sheets with seven content sections, not seven forced H1 pages.

## Tasks
- T1 [S1,S2,S3] delegated, pending — editable page/spread UI and fragment-aware coordinates; focused tests and browser edit checks.
- T2 [S4] delegated, pending — native physical-page PDF layout and lifecycle regression tests; actual browser PDF verification.
- T3 [S1-S4] inline, pending — integration, full tests, typecheck, independent high-risk verification. Risk: item 3 shared layout/export behavior; item 4 export lifecycle.

## Log
- L1: "bueno, hazlo y repara el puto view, el export pdf tienen el mismo bug de 7 paginas cuando son 2 hojas."
- L2: Source at `H:/DevCode/makeDoc2/My Grimoire/Draft/Chapter 1/Welcome.md` contains seven H1 sections. Real Chromium151: editor2/preview7; removing forced H1 break gives3, even after margin normalization. Native editor wrapped columns must be source of truth. User files remain read-only.
- L3: Browser-only native nested-column spread prototype preserves one editor and original two-page geometry with `box-decoration-break: clone`; more-page and pointer-coordinate checks remain required.
- L4: Existing dirty PagePreview changes are prior work from this conversation; preserve until obsolete path is deliberately disconnected. RDD globally off. Approximate implementation forecast exceeds 400 lines; no publishing requested.
