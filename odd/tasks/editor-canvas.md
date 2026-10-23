Objective: spec module 4.1 (editor and layout canvas), done in order. Branch: main (solo repo, commits per task). Delivery: ask-on-risk, no PR. Test runner: none configured; checks are `tsc -p tsconfig.app.json --noEmit`, `oxlint src`, `vite build`.

## Specs
- S1: "Vista de trabajo con aspecto de hoja física (canvas con paginación virtual configurable en tiempo real)." Formatting controls for the text (bold, italic, headings, lists, alignment) so the document can be edited without typing Markdown. (Assumption: the spec has no explicit toolbar list; toolbar is the spec's "barra de herramientas" under components/editor.)
- S2: "Manejo visual de imágenes: flujo de texto alrededor de la imagen (*wrap text*), anclaje a cabecera, pie o fondo de página con opacidad ajustable." Also from section 2: "alineación, flotado (*text wrap*), ajuste de dimensiones y marcos decorativos." Image attributes must survive the Markdown round trip.
- S3: "vistas en pliegos/spreads y página única" (section 2).
- S4: "Soporte nativo para maquetación a dos columnas con balanceo automático de texto."

## Tasks
- T1 | S1 | inline | status: done | commit: baf1baa | Formatting toolbar for the editor
- T2 | S2 | inline | status: done (anchored-image PDF fidelity unverified) | commit: dcd0bb2 | Image node: insert, align/wrap, size, frame, opacity, anchor; Markdown round trip
- T3 | S3 | inline | status: done (not seen in the running app) | commit: bba6633 | Page and spread views via Paged.js preview
- T4 | S4 | inline | status: done (CSS only; balance under Paged.js unverified) | commit: see git log (feat(editor): column break rules) | Column balancing and block break rules

## Log
- L1 (2026-10-22): "empieza con 1, en orden." (context: module 1 of the gap list = Editor 4.1: no formatting toolbar; images only the base extension; viewMode in the store without UI or spreads; column balancing is only CSS column-count)
- L2 route declaration: all tasks inline; no Writer trigger (units are sequential and dependent on the shared editor files).
- L3: T2 evidence: RED = image.test.ts failed to resolve ./image; GREEN = 4 vitest tests pass (plain image stays Markdown, styled image round-trips as <img data-*>, anchors round-trip, alt text cannot break out of the attribute). Added devDependencies vitest + jsdom and `pnpm test`.
- L4: T2 limits: header/footer/background anchoring is CSS absolute positioning against the sheet; not verified inside the Paged.js export. Text alignment buttons were left out of the toolbar on purpose: plain Markdown cannot store paragraph alignment, so it would be lost on reload.
- L5: T3 = ViewMode is now edit|pages|spreads (old single|spread was unused). Preview paginates a copy of the hidden editor DOM with the same Paged.js path as the export (shared `paginate`), spreads put page 1 alone on the right. Checks: tsc -p tsconfig.app.json, oxlint, vitest (4), vite build. NOT seen running: no desktop session was driven, so Paged.js screen layout, spread pairing and zoom are unverified.
- L6: T4 = break-inside/orphans/widows rules for blockquote, li, pre and images; column-fill: balance made explicit. Existing statblock/read-aloud/heading break rules were already present. Real balance inside Paged.js pages is unverified.
