Objective: Scrivener-style binder in the file explorer: Draft (chapters, folders, md files), Research and Trash sections. Branch: main (commit per task). Delivery: ask-on-risk, no PR. Test runners: vitest (`pnpm test`) and `cargo test` in src-tauri; also `tsc -p tsconfig.app.json --noEmit`, `oxlint src`, `vite build`.

## Specs
- S1: "en el explorador de archivos, nos falta la parte de \"Draft\" para los capitulos/folders y los md files." (a Draft section holding chapters/folders and md files)
- S2: "la sección de Research y trash, como en Scrivener" (a Research section and a Trash section, Scrivener-like)
- Assumptions (mine, not from the user, to confirm): the three sections are real folders `Draft/`, `Research/`, `Trash/` at the workspace root (plain files, local-first); the binder is set up by an explicit button, never silently inside a folder the user merely opened; Trash is a soft delete (move + restore); "Empty Trash" is the only permanent delete, asks for confirmation, and is limited to the folder named Trash inside the app's fs scope; only .md files open in the editor (Research may hold other files, shown but not opened).

## Tasks
- T1 | S1,S2 | inline | status: PARTIAL: pure logic done (src/lib/binder.ts, 12 tests); explorer UI not wired yet | commit: see git log | Binder sections: detect/setup Draft, Research, Trash; render sections; only .md opens
- T2 | S2 | inline | status: pending | commit: - | Trash: move to Trash and restore (manifest), drag onto Trash
- T3 | S2 | inline | status: pending | commit: - | Empty Trash: Rust command guarded by fs scope, confirm dialog
- T4 | S1 | - | status: NOT STARTED, needs the user's call | commit: - | Manual chapter order inside Draft (alphabetical with 01-, 02- prefixes vs an order file)

## Log
- L1 (2026-10-22): "en el explorador de archivos, nos falta la parte de \"Draft\" para los capitulos/folders y los md files.\nla sección de Research y trash, como en Scrivener"
- L2 route declaration: inline; T1-T3 sequential on FileTree/useFileSystem, no Writer trigger.
- L3 risk: T3 permanently deletes user files (data/irreversible: high-risk item 1); T1/T2 move files (reversible via Trash).
