# Grimoire Maker

**Grimoire Maker** is a local-first desktop publishing and layout application for tabletop RPG authors, Game Masters, and narrative writers. Built with **Tauri v2**, **React 19**, **Tiptap**, and **Paged.js**, it lets you write in plain Markdown while designing print-ready manuals, one-shots, and supplements with real physical pagination and PDF export.

---

## Quick Path

1. **Install dependencies:**
   ```bash
   pnpm install
   ```
2. **Run in development mode:**
   ```bash
   pnpm dev          # Frontend dev server (Vite)
   pnpm tauri dev    # Full desktop application (Tauri + Rust backend)
   ```
3. **Verify tests, types, and linting:**
   ```bash
   pnpm test         # Run Vitest unit & integration suites
   pnpm build        # Typecheck (tsc -b) and bundle frontend
   pnpm lint         # Run Oxlint static analysis
   cargo test --manifest-path src-tauri/Cargo.toml
   ```

---

## Core Capabilities

| Area | Features |
|------|----------|
| **Physical Page Canvas & Editor** | Real-time WYSIWYG Markdown editing (`A4`, `Letter`, `B5`), sequential multi-column text flow, physical sheet gaps, and `25%`–`300%` zoom (`Ctrl + wheel`). |
| **Print Preview & PDF Export** | Paged.js single-page and facing-page (*spreads*) preview with `3 mm` bleed and crop marks. Direct WebView2 PDF generation on Windows; paginated system print dialog on macOS/Linux. |
| **Multi-Tab & Split View** | Independent tabs preserving undo history, selection, and dirty state. Side-by-side **Split View** for editing or referencing two files at once. |
| **Read-Only File Previews** | Open reference assets directly in tabs: **Images** (PNG, JPEG, WebP, SVG, GIF, BMP, AVIF, ICO), **PDFs** (local PDF.js canvas viewer), and **Word `.docx`** documents. |
| **Binder Workspace** | Scrivener-style project folders (`Draft/`, `Research/`, `Trash/`), drag-and-drop organization, safe multi-file import, and native OS folder reveal. |
| **Movable Content Boxes & Images** | Every palette snippet (`statblock`, `read-aloud`, `character-sheet`, encounter/loot tables) and plugin insertion uses a borderless `standardContentBox` supporting **Push text** or free **Over text** millimeter positioning. Images support text wrapping, frames, opacity, page anchors, and free dragging. |
| **Ruler & Independent Guides** | Built-in **Ruler** overlay (mm/px, margins, bleed) plus an independent **Guides** menu (`+ Row` / `+ Column`) with persistent millimeter coordinates. |
| **Theme Customizer** | Customize theme colors (including `<hr>` dividers), import repeating header/footer background artwork embedded in CSS, and configure 6-slot headers/footers using `{book}`, `{title}`, `{author}`, `{coAuthor}`, `{page}`, and `{pages}`. |
| **Declarative Mods & Templates** | Folder-based `Mods/Templates` and `Mods/Snippets` with seeded D&D examples, `.zip` template import/export, and a **Mod Manager** to toggle packages without deleting files. |
| **Project & Page Properties** | Per-project `.grimoire-project.json` metadata (`Book name`, `Author`, and modal credit lists for `Co-Author` and `Artist` with social handle/platform) plus per-page YAML frontmatter overrides (`title`, `1` or `2` columns). |
| **Local Git & Auto Commits** | Built-in sidebar panel to initialize a repository, inspect working tree changes, view side-by-side diffs, stage/unstage files, create manual commits, and run periodic **Auto commits** (`1`–`1440 min`, default `20 min`). |
| **Preferences, Auto Save & Error Logs** | Live-reloading library paths (`Plugins`, `Snippets`, `Templates`, `Themes`, `Logs`) stored in `setting.json`, configurable auto-save timer (`1 s`–`24 h`), and bounded rotating diagnostic logs (`errors-0001.txt`–`errors-0016.txt`). |

---

## Feature Documentation

Detailed user and architecture guides are available in [`docs/`](docs/):

- [Getting Started & Project Creation](docs/getting-started.md)
- [Workspace Interface, Menus & Themes](docs/workspace-interface.md)
- [Documents, Tabs & Split View](docs/document-tabs.md)
- [Read-Only File Previews (PDF, DOCX, Images)](docs/file-previews.md)
- [Importing Files into Draft & Research](docs/file-import.md)
- [Standard Movable Content Boxes](docs/content-boxes.md)
- [Visual Ruler & Persistent Guides](docs/ruler.md)
- [Theme Customization, Backgrounds & Header/Footer](docs/theme-customization.md)
- [Declarative Mods & Mod Manager](docs/mods.md)
- [Preferences, Auto Save & Project/Page Properties](docs/preferences.md)
- [Local Git Source Control & Side-by-Side Diff](docs/version-control.md)
- [PDF Export Routes & Project Archives](docs/project-archives.md)
- [Diagnostic Error Logs](docs/error-logs.md)

---

## Project Structure

```text
grimoire-maker/
├── docs/                  # Feature and technical documentation
├── src/                   # React 19 + TypeScript frontend
│   ├── assets/            # App icons and seeded Mods (Templates & D&D Snippets)
│   ├── components/        # Editor, Layout, Mods, Project, Settings, Sidebar, Viewers, Git
│   ├── hooks/             # Filesystem, Print/PDF, AutoSave, Git status, Zoom hooks
│   ├── lib/               # Pure domain modules (themes, CSS guard, ZIP, DOCX, binder, Git)
│   ├── plugins/           # Trusted local TS/TSX/JS loader, lifecycle and generic UI slots
│   ├── stores/            # Zustand state stores
│   └── styles/            # Global print/page CSS and built-in themes (Parchment, Modern, Dark Fantasy, Sci-Fi)
└── src-tauri/             # Rust native backend (Tauri v2)
    └── src/
        ├── commands/      # IPC handlers (files, export, archive, mods, preferences, git, error_logs)
        ├── pdf/           # Windows WebView2 native PDF printing pipeline
        ├── config_root.rs # App configuration root & safe migration
        └── safe_copy.rs   # Non-destructive atomic directory/file copying
```

### Executable local plugins

Zoom and Ruler are complete copyable source packages in `src/assets/mods/Plugins/`, seeded into the default Plugins content folder without overwriting edits. Active packages are transpiled from disk and render through generic host slots. They are trusted code with the app's permissions, **not sandboxed**. See [Local plugin development](PLUGINS.md) for package layout, supported imports, activation and cleanup.

### Renaming files and Markdown references

Renaming a file from Files updates local Markdown links/images, reference definitions,
and HTML `src`/`href` attributes in the active project's saved `.md` files (including
closed documents). References are resolved relative to each document, not matched by
filename alone. URL fragments, queries and unrelated formatting are retained.

Open buffers receive the same reference update without saving unrelated unsaved edits.
The operation checks saved content again before publication and aborts on detected disk
conflicts. Ordinary publication failures attempt rollback; recovery backups are retained
if rollback cannot safely finish. This is not a crash-atomic multi-file filesystem
transaction. A remaining `.grimoire-rename-transaction` directory blocks further reference
renames: preserve its `journal.jsonl`, backups and committed marker for reconciliation;
do not delete it blindly or retry by overwriting files.

This applies to same-folder **file renames**, not directory renames, drag moves or Trash.
It leaves external URLs, prose, code examples, comments, frontmatter, CSS URLs and `srcset`
unchanged. The native scan is bounded (5,000 entries, 32 levels, 4 MiB per Markdown file,
32 MiB total); unsupported links/reparse points, invalid text or exceeded limits stop the
rename rather than silently skip references. Rebuild/restart the Tauri application after
updating, because this feature adds native commands; frontend hot reload alone is not enough.
