Objective: spec module 4.3 remainder: community template packages as .zip, auxiliary chapters and custom snippets. Branch: main (commit per task). Delivery: ask-on-risk, no PR. Test runner: vitest (`pnpm test`); also `tsc -p tsconfig.app.json --noEmit`, `oxlint src`, `vite build`.

## Specs
- S1: "Soporte para importar/exportar paquetes `.zip` o carpetas locales con la siguiente estructura:" (folders already work; this adds .zip import and export).
- S2: "Archivo de estilos base (`theme.css`)." (already supported for folders; must work from a .zip)
- S3: "Estructura inicial de documentos (`index.md`, capítulos auxiliares)."
- S4: "Colección de snippets propios."
- Assumptions (mine, not from the user): a package is `index.md` + optional `theme.css`, `chapters/*.md`, `snippets/*.md`, `assets/*`; applying a package that has chapters creates a project folder in the open workspace; imported zips are untrusted, so path traversal, size bombs, unknown file types and remote CSS references are rejected.

## Tasks
- T1 | S1 | inline | status: done | commit: a379397 | Zip reading/writing and package validation (pure, tested)
- T2 | S1,S2 | inline | status: done (import/export dialogs not exercised in a running app) | commit: 1c4dce9 | Import .zip and export a package from the catalog (fs wiring, UI)
- T3 | S3 | inline | status: pending | commit: - | Auxiliary chapters: loader and "create project" on apply
- T4 | S4 | inline | status: pending | commit: - | Package snippets in the palette (markdown insertion)

## Log
- L1 (2026-10-22): "sí," (continue with the next module; the previous message listed template .zip packages first)
- L2 route declaration: all tasks inline; sequential and sharing templates.ts/TemplateCatalog, no Writer trigger.
- L3 risk: T1/T2 handle untrusted archives (data safety) and add dependency fflate and fs write permission: named high-risk items 5 and 2 (security of archive input).
- L4: T1 evidence: RED = templatePackage.test.ts could not resolve ./templatePackage; GREEN = 21 tests (layout, unwrap, junk, index.md required, round trip, 5 path-escape forms, file-type whitelist, 3 remote-CSS forms, local CSS accepted, non-zip, entry limit, zip bomb). Mutation check: disabling the path rule and the size limit made 3 tests fail, restored. Streaming unzip stops at the size limit, so a lying declared size cannot bypass it.
- L5: native review of T1 skipped by the user's choice ("Omitir revisión nativa"): it required `gentle-ai sync`, whose dry-run showed 14 steps on global components (engram, skills, permissions, persona, theme). Independent verifier runs over T1+T2 instead (high-risk item named in L3).
- L6: T2 evidence: RED = templateIo.test.ts could not resolve ./templateIo; GREEN = 7 tests on an in-memory FS (nested folders, index.md written last, free id on collision incl. single-file templates, nothing written when refused, collect skips hidden/disallowed, export-import round trip). Own hardening pass before commit: RED = 7 Windows-name attacks accepted (reserved device names, trailing space, forbidden chars, over-long names, case-insensitive duplicates); fixed in checkPath/onfile. 55 tests total.
- L7: independent verifier (over a379397 + 1c4dce9) returned 2 BLOCKERS. (1) CORRECTION OF L4: my claim that the streaming unzip stops at the size limit was FALSE: fflate inflates the whole pushed buffer before reporting output, so a 1.5 MB zip drove peak RSS from 163 MB to 4126 MB (2.6 s) before the limit check ran. (2) The remote-CSS regex guard was bypassed by comment separators, CSS escapes (u:l(, @9mport, h<tps), image-set()/src()/cross-fade(), ftp/UNC/file schemes.
- L8: correction batch: (1) input is pushed in 4 KB slices and stops at the first failure, so overshoot is at most ~4 MB; `stats.inflated` seam + test with a 100 MB bomb at a 1 MB limit (RED proven by mutation: slice size set to 1 GB fails the test). (2) New src/lib/cssGuard.ts normalises like a browser (comment = separator, decode escapes) then refuses @import, image-set/cross-fade/image()/src()/element(), non-local url() (any scheme, //, UNC, drive paths; data:image allowed); 32 cases incl. every verifier bypass and the false positives it must allow. Also fixed the verifier advisories: package ids that are Windows device names, extensionless names, file-vs-folder conflicts, bidi/zero-width chars in names, export no longer follows symlinks. 97 tests total.
- L9: not changed on purpose: SVG stays an allowed type (only safe because it is rendered through <img>/blob URLs; scripts do not run there); index.md Markdown/HTML is not scanned for remote images; hand-made folders in themes/ and templates/ are not CSS-guarded (only zip imports are). Recheck limited to the two blockers is pending.
