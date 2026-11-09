# Grimoire Maker — Developer Guide & Architecture

This guide provides developers and contributors with a concise overview of Grimoire Maker's architecture, project layout, and core functional specifications.

---

## 1. Tech Stack Overview

Grimoire Maker is a local-first desktop publishing app built with **Tauri v2** and **React 19**:

```text
┌────────────────────────────────────────────────────────────┐
│                      Desktop Shell                         │
│ Tauri v2 (Rust Backend) + WebView2 (Win) / WebKit (macOS)  │
├────────────────────────────┬───────────────────────────────┤
│       Frontend Core        │      Publishing Engine        │
│ React 19 + TypeScript 7    │ Tiptap v3 (ProseMirror)       │
│ Vite 8 + Tailwind CSS v4   │ Paged.js (Physical Print)     │
│ Zustand (State Management) │ KaTeX (Math) + PDF.js         │
└────────────────────────────┴───────────────────────────────┘
```

- **Desktop Shell (Rust / Tauri v2):** Handles native file system access (`tauri-plugin-fs`), native dialogs (`tauri-plugin-dialog`), in-app updates (`tauri-plugin-updater`), process spawning, and thread-safe preference locking.
- **Frontend & State (React 19 & Zustand):** Decoupled UI with atomic Zustand stores (`documentStore`, `settingsStore`, `tabStore`, `modStore`).
- **Editorial & Layout Engine:** 
  - **Tiptap (ProseMirror):** WYSIWYG Markdown authoring with custom block attributes (alignment, indent, column spanning), section nodes, tables, and movable content boxes.
  - **Paged.js:** Real-time physical page rendering (`A4`, `Letter`, `B5`), 3 mm bleed, crop marks, facing spreads, and CSS Paged Media `@page` layout.

---

## 2. Repository Layout

```text
grimoire-maker/
├── src/
│   ├── components/            # UI components grouped by feature domain
│   │   ├── editor/            # Page canvas, PageView, Tiptap extensions, table controls
│   │   ├── layout/            # Top bar, status bar, document tabs, split view
│   │   ├── sidebar/           # Binder file tree, Scrivener folders, local Git panel
│   │   ├── snippets/          # Snippet palette, insertion, category tree
│   │   ├── templates/         # Template catalog, project creator, chapter blueprints
│   │   ├── settings/          # Preferences dialog, Theme Customizer, document order
│   │   ├── ruler/             # Native millimeter ruler and persistent guides
│   │   └── viewers/           # Read-only tab previews (PDF, DOCX, Images)
│   ├── stores/                # Zustand stores (tab, document, settings, mod, explorer)
│   ├── lib/                   # Pure domain logic (themes, CSS guard, ZIP/DOCX, Git, binder)
│   ├── plugins/               # Built-in official plugins (bookmarks, zoom, quotes)
│   └── types/                 # Core TypeScript definitions (document, settings, plugin)
├── src-tauri/                 # Rust application, Tauri configuration, NSIS wizard templates
├── docs/                      # Platform installation guides and developer documentation
└── odd/                       # Organic Driven Development (ODD) specs and task logbook
```

---

## 3. Core Functional Specifications (Executive Summary)

Detailed architecture notes live under [`odd/spec/`](../odd/spec/). Below is an executive summary of the primary systems:

### 3.1. Physical Page Canvas & Sections ([`odd/spec/content-boxes.md`](../odd/spec/content-boxes.md))
- Documents are structured as sequences of `section` nodes. 
- Sections define page column count (`1`, `2`, or `3`). Inserting a section break (`Mod-Enter`) splits sections and forces a page break.
- Headings, paragraphs, blockquotes, and horizontal rules carry custom attributes: text alignment (`textAlign`), indentation level (`indent`), and column spanning (`columnSpan: "all"`).

### 3.2. Standard Content Boxes (`standardContentBox`)
- Dragged palette snippets and callouts are wrapped inside a movable container without decorative borders.
- Supports two positioning modes:
  - **Push text:** Statically anchored inside the document flow; reorders text around it.
  - **Over text:** Positioned at explicit millimeter coordinates (`data-x-mm`, `data-y-mm`, `data-width-mm`, `data-height-mm`) relative to the page.

### 3.3. Native Ruler & Persistent Guides ([`odd/spec/ruler.md`](../odd/spec/ruler.md))
- Native canvas overlay rendering millimeter / pixel scales, page margins, and 3 mm bleed zones.
- Interactive horizontal and vertical guides (`+ Row` / `+ Column`) that persist across sessions in `setting.json`.

### 3.4. Binder Workspace & Scrivener Structure ([`odd/spec/scrivener.md`](../odd/spec/scrivener.md))
- Local-first projects follow standard manuscript folders: `Draft/` (manuscript chapters), `Research/` (notes and background), and `Trash/` (soft deletion).
- Reference-safe renaming automatically updates internal Markdown links when renaming files or folders.
- Automatic background saves (`useAutoSave`) with dirty-tab caching and isolated undo/redo stacks.

### 3.5. Mod Ecosystem: Templates, Snippets & Themes ([`odd/spec/spec-mod-creator-export.md`](../odd/spec/spec-mod-creator-export.md))
- **Templates:** Multi-chapter project folders with `index.md` frontmatter defining default theme, page size, and column layout. Exportable as `.zip` packages.
- **Snippets:** Hierarchical folders of `.md` files under `Mods/Snippets/` rendered as collapsible palette groups.
- **Themes:** Standard `.css` stylesheets defining CSS custom properties (`--g-page`, `--g-ink`, `--g-accent`, `--g-border`) scoped under `.theme-<id>`.

### 3.6. Official Plugins & Security Boundary ([`odd/spec/plugins.md`](../odd/spec/plugins.md), [`security-plugins.md`](../odd/spec/security-plugins.md))
- The application ships only compiled, official built-in plugins (**Bookmarks**, **Zoom**, **Quotes**).
- Plugin implementations are bundled at build-time; files on disk never execute dynamic code.
- Plugins can be toggled on or off from the **Plugins** tab in Mod Manager.

### 3.7. Unified Preferences & Live Directory Migration ([`odd/spec/preferences.md`](../odd/spec/preferences.md))
- Configuration lives in `%APPDATA%/app.grimoiremaker.desktop` (Windows) or `~/Library/Application Support/app.grimoiremaker.desktop` (macOS).
- Changing content folders in **Settings → Preferences** safely copies files and hot-reloads libraries without requiring an app restart.

---

## 4. Developer Commands & Quality Gates

Run these commands before submitting pull requests:

```bash
# 1. Start development server with hot-reload
pnpm dev

# 2. Run full test suite (130+ test suites via Vitest)
pnpm test

# 3. Strict TypeScript typechecking and production bundle build
pnpm build

# 4. Fast static analysis and linting (Oxlint)
pnpm lint

# 5. Rust unit tests (when modifying src-tauri)
cargo test --manifest-path src-tauri/Cargo.toml
```

For platform packaging and installer testing, refer to:
- [Windows Installer & Portable Guide](installer_windows.md)
- [macOS DMG Guide](installer_mac.md)
