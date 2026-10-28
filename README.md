# Grimoire Maker

**Grimoire Maker** is a local-first desktop publishing and layout studio for book authors, poets, technical writers, and tabletop RPG creators. Built with **Tauri v2**, **React 19**, **Tiptap**, and **Paged.js**, it lets you write in plain Markdown while designing print-ready books, reports, magazines, and rulebooks with real physical pagination and native PDF export.

---

## Table of Contents

- **Part I — Overview & Installation**
  - [About This Project](#about-this-project)
  - [What Does Grimoire Maker Include?](#what-does-grimoire-maker-include)
  - [How to Install](#how-to-install)
- **Part II — For Developers: Mods & Contributing**
  - [For Developers: How to Make Mods](#for-developers-how-to-make-mods)
    - [1. Creating Templates](#1-creating-templates)
    - [2. Creating Snippets](#2-creating-snippets)
    - [3. Creating Themes](#3-creating-themes)
    - [4. Creating Local Plugins](#4-creating-local-plugins)
  - [How to Contribute (Pull Request from a Fork)](#how-to-contribute-pull-request-from-a-fork)

---

## About This Project

Most writing tools force a choice between clean plain-text authoring (Markdown editors) and visual page layout (desktop publishing suites). **Grimoire Maker** bridges both worlds:

- **Local-First & Plain Text:** Your manuscripts live on your disk as standard `.md` files organized inside a project folder. No cloud lock-in or proprietary binary formats.
- **Physical Page Canvas:** Write directly on `A4`, `Letter`, or `B5` sheets with `1` or `2` columns, live millimeter rulers, persistent guides, and movable layout boxes.
- **Versatile Editorial Engine:** Designed equally for literary novels, poetry collections, executive reports, academic papers, zines, and tabletop RPG adventures or core rulebooks.

---

## What Does Grimoire Maker Include?

### Core Workspace & Editor

| Area | Included Capabilities |
|------|-----------------------|
| **Physical Page Canvas** | Real-time WYSIWYG Markdown editing on `A4`, `Letter`, or `B5` sheets, sequential multi-column flow (`1` or `2` columns), physical page gaps, and `25%`–`300%` zoom (`Ctrl + wheel`). |
| **Print Preview & PDF Export** | Paged.js single-page and facing-page (*spreads*) preview with `3 mm` bleed and crop marks. Native WebView2 PDF generation on Windows and paginated system print export on macOS/Linux. |
| **Multi-Tab & Split View** | Independent tabs that preserve undo history, cursor selection, and unsaved state. Side-by-side **Split View** for editing or referencing two documents simultaneously. |
| **Binder Project Structure** | Scrivener-inspired workspace folders (`Draft/`, `Research/`, `Trash/`), drag-and-drop file organization, reference-safe file renaming, and read-only tab previews for **PDF**, **DOCX**, and **Images**. |
| **Movable Content Boxes & Images** | Snippets and callouts insert inside a `standardContentBox` supporting **Push text** flow or free **Over text** millimeter coordinates. Images support wrapping, frames, opacity, and page anchors. |
| **Ruler & Persistent Guides** | Millimeter/pixel **Ruler** overlay displaying page margins and bleed, plus custom **Row / Column Guides** (`+ Row` / `+ Column`) saved across sessions. |
| **Local Git & Auto-Save** | Built-in Git sidebar to initialize repositories, inspect side-by-side diffs, stage/unstage files, commit manually, or run scheduled **Auto Commits** alongside configurable **Auto Save**. |

### Built-in Themes (7 Editorial Styles)

- **Parchment:** Classic warm parchment and burgundy palette for fantasy manuals, grimoires, and historical settings.
- **Executive / Modern Doc:** Clean corporate typography with high-contrast headings and neutral table borders (`#e1e4e8`) for technical docs and business reports.
- **Book / Classic Novel:** Warm cream paper (`#fdfbf7`), literary serif typography, indented paragraphs, and centered chapter headers for novels and poetry.
- **Minimal Monochrome:** Pure ink-on-white layout optimized for home laser/inkjet printing without background tinting.
- **Editorial Magazine:** High-contrast display headings, accent rules, and structured sidebars for zines, artbooks, and modern publications.
- **Dark Fantasy:** Gothic dark mode for horror, occult investigations, and low-light reading.
- **Sci-Fi:** Uppercase tracked headers and cyan-accented panels for cyberpunk and futuristic technical manuals.
- **Theme Customizer:** Override colors, import repeating header/footer artwork, and configure 6-slot running headers/footers (`{book}`, `{title}`, `{author}`, `{coAuthor}`, `{page}`, `{pages}`).

### Built-in Project Templates (8 Complete Blueprints)

1. **Book / Novel:** Frontmatter, prologue, multi-part chapter structure, epilogue, and author notes.
2. **Poetry Collection:** Sectioned movements, epigraphs, individual poem layouts, and index of first lines.
3. **Corporate / Technical Report:** Executive summary, methodology, findings, risk matrix, and appendices.
4. **Academic Paper / Whitepaper:** Abstract, literature review, methodology, results, discussion, and references.
5. **Magazine / Zine Issue:** Editorial letter, feature articles, interviews, columns, and review spreads.
6. **Worldbuilding / Lore Bible:** Cosmology, geography, factions, timelines, magic/technology systems, and glossary.
7. **RPG Adventure:** Adventure overview, dramatic hooks, act-by-act scenes, NPCs, locations, and appendices.
8. **TTRPG Core Rulebook / Homebrew Manual:** 9-part layered rulebook architecture covering preliminaries, core engine, character creation, combat, subsystems, GM tools, bestiary, equipment, and quick reference sheets.

### Built-in Snippet Library

- **General Editorial Categories:** `Academic and Reports`, `Books and Novels`, `Corporate and Business`, `Creative and Journalism`, `Personal and Minimal`, and `Technical Documentation`.
- **Rol Adventures (Nested System Library):** Organized with collapsible sub-groups for:
  - `General & Utilities` (Read-aloud boxes, dice tables, called shots, quest contracts, room entries, loot tables)
  - `D&D 5e`, `Pathfinder 2e`, `Call of Cthulhu`, `Ars Magica 5e`, `Hitos`, `Fabula Ultima`, and `Daggerheart` (system-specific character sheets, statblocks, and reference blocks).

---

## How to Install

### Option A: Prebuilt Installer (End Users)

1. Go to the [**Releases**](../../releases) page of this repository.
2. Download the installer for your operating system:
   - **Windows:** `.msi` or `-setup.exe`
   - **macOS:** `.dmg`
   - **Linux:** `.AppImage` or `.deb`
3. Run the installer and launch **Grimoire Maker**. On first launch, default Templates, Snippets, Themes, and Plugins are automatically seeded into your local configuration folder.

### Option B: Build from Source (Developers)

#### Prerequisites

- **Node.js** `20+` and **pnpm** `9+`
- **Rust** stable toolchain (`rustup`, `cargo`)
- **Platform native dependencies:**
  - **Windows:** Microsoft Edge WebView2 Runtime and Visual Studio C++ Build Tools
  - **macOS:** Xcode Command Line Tools
  - **Linux (Debian/Ubuntu):** `libwebkit2gtk-4.1-dev`, `build-essential`, `curl`, `wget`, `file`, `libxdo-dev`, `libssl-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`

#### Setup & Run

```bash
# 1. Clone the repository
git clone https://github.com/<your-org>/grimoire-maker.git
cd grimoire-maker

# 2. Install frontend dependencies
pnpm install

# 3. Start the full desktop app in development mode
pnpm tauri dev

# 4. Build a production desktop bundle
pnpm tauri build
```

---

## For Developers: How to Make Mods

Grimoire Maker uses a declarative, folder-based modding architecture. Mods live in your local app configuration directory (viewable and customizable under **Settings → Preferences**):

- **Windows:** `%APPDATA%\com.grimoire.maker\`
- **macOS:** `~/Library/Application Support/com.grimoire.maker/`
- **Linux:** `~/.config/com.grimoire.maker/`

You can enable, disable, import, or export mods at any time from the built-in **Mod Manager** without deleting files on disk.

---

### 1. Creating Templates

A **Template** is a folder inside `Mods/Templates/<your-template-id>/` (or a `.zip` archive containing that structure) with an `index.md` entrypoint and any number of chapter folders and Markdown files.

```text
Mods/Templates/my-custom-template/
├── index.md
├── README.md
├── 01 - Introduction/
│   ├── 01-overview.md
│   └── 02-getting-started.md
└── 02 - Main Content/
    └── 01-chapter-one.md
```

**`index.md` Frontmatter Example:**

```markdown
---
templateName: My Custom Template
title: Untitled Project
pageSize: letter
columns: 2
theme: parchment
---
# My Custom Template

Describe the purpose and structure of your template here.
```

- Supported `pageSize`: `a4`, `letter`, `b5`
- Supported `columns`: `1`, `2`
- Supported `theme`: `parchment`, `modern`, `classic-novel`, `minimal-print`, `editorial-magazine`, `dark-fantasy`, `sci-fi` (or any custom theme ID)

---

### 2. Creating Snippets

**Snippets** are reusable Markdown blocks stored inside `Mods/Snippets/`. Folder hierarchy directly controls how snippets are grouped in the **Snippets** sidebar palette:

- **Top-level folder** → Main collapsible category (e.g., `Mods/Snippets/Rol Adventures/`)
- **Nested subfolder** → Collapsible subgroup inside that category (e.g., `Mods/Snippets/Rol Adventures/D&D 5e/`)
- **`.md` file** → Draggable/double-clickable snippet item

```text
Mods/Snippets/
└── My Custom Category/
    ├── quick-callout.md
    └── [Subgroup Name]/
        ├── custom-sheet.md
        └── encounter-card.md
```

Write standard Markdown (tables, blockquotes, headings, task lists) inside each `.md` file. When inserted into a page, Grimoire Maker automatically wraps the snippet in a movable `standardContentBox`.

---

### 3. Creating Themes

**Themes** are standard `.css` files placed in the `Themes/` directory (e.g., `Themes/my-theme.css`). The filename (without `.css`) becomes the theme ID (`my-theme`), and all rules are scoped under `.theme-<id>`.

```css
/* @name: Royal Chronicle */
/* grimoire-colors:start */
.theme-my-theme {
  --g-page: #fbf8f1;
  --g-ink: #221c15;
  --g-accent: #7a1c1c;
  --g-border: #d6c7b2;
}
/* grimoire-colors:end */

.theme-my-theme .page-sheet {
  background: var(--g-page);
  color: var(--g-ink);
  font-family: "Georgia", "Times New Roman", serif;
  line-height: 1.65;
}

.theme-my-theme h1,
.theme-my-theme h2 {
  color: var(--g-accent);
  border-bottom: 1px solid var(--g-border);
}
```

- `/* @name: Display Name */` defines the human-readable label in the Theme selector.
- Wrapping CSS custom properties in `/* grimoire-colors:start */ ... /* grimoire-colors:end */` exposes them to the visual **Theme Customizer**.

---

### 4. Creating Local Plugins

Executable plugins live in `Mods/Plugins/<PluginName>/index.tsx` (or `.ts` / `.js`). Active plugins are transpiled locally and can register commands, toolbar widgets, sidebar panels, page overlays, and editor tools.

> **Security Note:** Local plugins run with full application permissions and are **not sandboxed**. Only install plugins from sources you trust.

```tsx
import type { GrimoirePlugin } from '../../../types/plugin'

const wordCounterPlugin: GrimoirePlugin = {
  id: 'custom-word-counter',
  name: 'Custom Word Counter',
  version: '1.0.0',
  activate(api) {
    api.registerCommand({
      id: 'custom-word-counter.insert-stamp',
      title: 'Insert Timestamp',
      run: () => {
        api.insertContent(`\n> _Updated: ${new Date().toISOString()}_\n`)
      },
    })
  },
}

export default wordCounterPlugin
```

**Available `PluginApi` Registration Hooks:**
- `api.registerCommand({ id, title, run })`
- `api.registerToolbar({ id, title, render })`
- `api.registerPanel({ id, title, render })`
- `api.registerOverlay({ id, title, render })`
- `api.registerEditorTool({ id, title, render })`
- `api.registerPreviewToolbar({ id, title, render })`
- `api.registerPageBehavior({ id, ... })`
- `api.registerContextAction({ id, title, ... })`

---

## How to Contribute (Pull Request from a Fork)

Contributions, bug fixes, new templates, themes, and RPG system snippets are welcome! Follow this workflow to submit a clean Pull Request:

### 1. Fork and Clone

1. Click **Fork** at the top-right of the GitHub repository page to create your personal copy.
2. Clone your fork locally and add the original repository as `upstream`:

```bash
git clone https://github.com/<your-username>/grimoire-maker.git
cd grimoire-maker
git remote add upstream https://github.com/<original-owner>/grimoire-maker.git
```

### 2. Create a Focused Branch

Always branch off the latest development branch (`dev` or `main`) using a descriptive prefix:

```bash
git fetch upstream
git checkout -b feat/my-improvement upstream/dev
```

Branch naming conventions:
- `feat/<name>` — New features, templates, themes, or snippets
- `fix/<name>` — Bug fixes
- `docs/<name>` — Documentation updates
- `refactor/<name>` — Internal code restructuring without behavior changes

### 3. Run Quality Checks Before Committing

Every Pull Request must pass tests, typechecking, and linting before review:

```bash
# Run unit and integration tests (Vitest)
pnpm test

# Typecheck TypeScript and build frontend bundle
pnpm build

# Run static analysis (Oxlint)
pnpm lint

# Run Rust backend tests (when touching src-tauri/)
cargo test --manifest-path src-tauri/Cargo.toml
```

### 4. Commit with Conventional Commits

Write clear, atomic commits using the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```bash
git add <modified-files>
git commit -m "feat(snippets): add Call of Cthulhu vehicle chase table"
```

### 5. Push and Open a Pull Request

```bash
git push -u origin feat/my-improvement
```

1. Open your fork on GitHub and click **Compare & pull request**.
2. Target the `dev` branch of the upstream repository.
3. Describe **what** changed, **why** it matters, and **how** you verified it (attach screenshots when modifying themes, templates, or UI components).
