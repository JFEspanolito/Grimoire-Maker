# Declarative mods

Open **Mod Manager → Open Mods Folder**. The app creates `Mods` inside its writable
application configuration directory, not inside a project or installation folder.
The manager displays the actual path (on Windows, normally under
`%APPDATA%/app.grimoiremaker.desktop/Mods`).

```text
Mods/
  Templates/
    classic-fantasy/
      index.md
    my-adventure/
      index.md
      chapters/
        01-introduction.md
      assets/
        map.png
      snippets/
        encounter.md
  Snippets/
    Dungeons and Dragons/
      character-sheet.md
      loot-table.md
    My Notes/
      locations/
        tavern.md
  Plugins/             # Reserved; no executable plugins are loaded
```

## Install and share

1. Download a community folder, or unzip its archive.
2. Put the folder directly inside `Mods/Templates` or `Mods/Snippets`.
3. Restart Grimoire Maker, or select **Refresh** in Mod Manager.
4. Enabled templates appear in Templates; enabled snippets appear in collapsible
   groups named after their folders. Double-click a snippet to insert it.

To create a mod, copy an example folder, give it a new name, and edit its Markdown.
Share that folder or a ZIP containing it. There is no manifest, installation script,
JavaScript, server, upload account, or compilation step. Templates also retain their
existing Import/Export ZIP buttons; imported ZIPs now go into `Mods/Templates`.
For snippets, unzip/copy the folder manually.

Template directory names use letters, digits, hyphens and underscores. Every
template has a regular `index.md`; optional `chapters/*.md`, `assets/`, package
`snippets/*.md`, and the existing scoped `theme.css` format remain supported.
For example:

```markdown
---
templateName: My Adventure
title: The Forgotten Keep
theme: parchment
pageSize: a4
columns: 2
---
# The Forgotten Keep

Begin your adventure here.
```

Snippet folders may have spaces. Each `.md` file becomes a snippet; nested folders
are supported up to four levels. Files are read alphabetically, so numeric prefixes
can control order. Optional `snippetName` frontmatter changes the display label:

```markdown
---
snippetName: Tavern encounter
---
## The stranger in the corner

Describe the encounter here.
```

The D&D examples preserve the existing character-sheet, statblock and read-aloud
blocks using their declarative `div data-type` wrappers. These are ordinary Markdown
content, not plugins.

## Themes and template application

Standalone themes still live in `themes/<id>.css` beside Mods. IDs use letters,
numbers, hyphens and underscores; `parchment`, `modern`, `dark-fantasy` and `sci-fi`
are reserved. Every theme must target its own `[data-theme='<id>']` selector.

```css
/* @name: Sea Foam */
[data-theme='sea-foam'] {
  --page-bg: #eef8f6;
  --page-fg: #12302c;
  --page-font: Georgia, serif;
  --heading-font: Georgia, serif;
  --heading-color: #0b5d54;
  --accent: #14a393;
  --statblock-bg: #dcf0ec;
  --readaloud-bg: #cfe8e3;
}
```

`/* @name: ... */` is the selector label. CSS is applied as-is; avoid remote
`@import` URLs. A template's `theme.css` uses its template folder ID; when index.md
does not specify a theme, the package theme is selected automatically. Changes
are also picked up when the application window regains focus.

Applying a template creates a unique `Draft/<template-id>/` containing index.md,
chapters and assets without replacing existing project files. A single-document
package can still fill an untitled editor without a project; packages containing
chapters or assets require an open project. Package snippets appear as soon as
the enabled template loads, without requiring application of the template.

## Activation and preservation

Each folder has a checkbox in Mod Manager. Changes affect the current catalog and
survive restarts via `mods.json` beside `Mods`. They never delete files, alter open
documents, or remove content already inserted/applied. Preferences are local and
are not part of a shared mod. Renaming a folder gives it a new mod identity.

Examples are seeded once. Existing files are never overwritten. Editing or deleting
an example after first startup is respected; `.examples-seeded` records that setup
already ran. Legacy `templates/` and `themes/` remain readable without migration.
Copy a legacy template into `Mods/Templates` to manage it here; the modern folder
takes precedence over a legacy template with the same ID, including when disabled.

Invalid files appear as manager errors without hiding unrelated valid mods.
Linked folders/files are skipped; Markdown is limited to 512 KiB per file, with
bounded group counts, nesting and discovery size. If `mods.json` is malformed, it
is not silently replaced: repair or move it aside deliberately before changing
activation. Failed preference publication can leave a harmless `.tmp` diagnostic
file beside it; the previous preferences remain intact.

Community executable plugins and the Ruler mod are stage 2. The existing built-in
Ruler continues to work and is not managed by these content-mod checkboxes.


On Windows the default configuration root is `%APPDATA%/GriomoireMaker`. Existing configuration is copied from the former identifier-named directory without deleting the original; custom external library paths are retained. Editable theme examples and their README are installed in Themes Path, independently of Markdown snippet/template examples.
