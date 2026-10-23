Objective: spec module 4.1 (editor and layout canvas), done in order. Branch: main (solo repo, commits per task). Delivery: ask-on-risk, no PR. Test runner: none configured; checks are `tsc -p tsconfig.app.json --noEmit`, `oxlint src`, `vite build`.

## Specs
- S1: "Vista de trabajo con aspecto de hoja física (canvas con paginación virtual configurable en tiempo real)." Formatting controls for the text (bold, italic, headings, lists, alignment) so the document can be edited without typing Markdown. (Assumption: the spec has no explicit toolbar list; toolbar is the spec's "barra de herramientas" under components/editor.)
- S2: "Manejo visual de imágenes: flujo de texto alrededor de la imagen (*wrap text*), anclaje a cabecera, pie o fondo de página con opacidad ajustable." Also from section 2: "alineación, flotado (*text wrap*), ajuste de dimensiones y marcos decorativos." Image attributes must survive the Markdown round trip.
- S3: "vistas en pliegos/spreads y página única" (section 2).
- S4: "Soporte nativo para maquetación a dos columnas con balanceo automático de texto."

## Tasks
- T1 | S1 | inline | status: pending | commit: -  | Formatting toolbar for the editor
- T2 | S2 | inline | status: pending | commit: -  | Image node: insert, align/wrap, size, frame, opacity, anchor; Markdown round trip
- T3 | S3 | inline | status: pending | commit: -  | Page and spread views via Paged.js preview
- T4 | S4 | inline | status: pending | commit: -  | Column balancing and block break rules

## Log
- L1 (2026-10-22): "empieza con 1, en orden." (context: module 1 of the gap list = Editor 4.1: no formatting toolbar; images only the base extension; viewMode in the store without UI or spreads; column balancing is only CSS column-count)
- L2 route declaration: all tasks inline; no Writer trigger (units are sequential and dependent on the shared editor files).
