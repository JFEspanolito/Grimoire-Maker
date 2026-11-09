# Grimoire Maker mods

Copy a template folder containing `index.md` into `Templates/`.
Copy a folder containing Markdown snippets into `Snippets/`.
Restart the app or use **Mod Manager → Refresh**. No manifest or code is required.

To share a mod, copy or ZIP its folder. Extract downloaded ZIPs before placing
them here. Templates also support the application's Import/Export ZIP buttons.

Template folder names use letters, numbers, hyphens and underscores. Use
`templateName: My Adventure` in index.md frontmatter for its display name.
Optional `chapters/*.md`, `assets/` and `snippets/*.md` are supported.

Snippet folder names become collapsible group names. Optional `snippetName`
frontmatter sets an individual snippet's label. Nested folders are supported
up to four levels; files are read in alphabetical order.

Mod Manager activation settings are local and are not included when sharing.
Disabling a mod does not remove files or previously inserted document content.
Examples are seeded only once; editing or deleting them will not be undone.

## Plugins

Grimoire Maker includes official built-in plugins (such as Bookmarks and Zoom).
You can enable, disable, or restore them from the **Plugins** tab of the Mod Manager.

## Sharing your mods

Mod Manager > Create Mod (or the contextual entries in the editor) exports your own
themes, snippets and templates as files other people can import with **Import Mod**.
Nothing is shared automatically; you choose where each file is saved.

| Mod | Export | File | Import accepts |
| --- | --- | --- | --- |
| Theme | Export Selected Theme / Customize Theme > Export | `<id>.css`, or `<id>.zip` when the theme embeds fonts or images of 2 KiB or more | a `.css`, or a `.zip` with `theme.css` and an `assets/` folder (optionally inside one wrapper folder) |
| Snippet | Save Selection as Snippet / Create Mod > Snippets | one `.md` file, or `snippets-pack.zip` with `<Category>/<name>.md` | a single `.md`, a pack whose top-level folders are categories, or a folder or zip of `.md` files |
| Template | Create Mod > Templates / File > Export > Export as Template | a `.zip` with `template.json` at its root next to the project tree | that `.zip` (or the same file renamed `.gmtemplate`), or a classic zip with an `index.md` |

- **Themes.** The file starts with a `/* @name: ... */` comment and uses the
  `[data-theme='<id>']` selector; importing rewrites the selector to a new unique id.
  Fonts and images in a theme pack are written as relative `url(assets/...)` and are
  embedded back into the theme on import. Remote resources (`@import`, `http:` URLs)
  are refused in both directions. Allowed asset types: woff2, woff, ttf, otf, png, jpg,
  webp, gif and svg.
- **Snippets.** An exported snippet is plain Markdown with `snippetName`, an optional
  `author` and `tags: [Category]` frontmatter. Page layout (column breaks, content-box
  width and position, image anchors and sizes in millimetres) is removed so the snippet
  fits wherever it is inserted; tables, headings, lists and read-aloud, statblock and
  character-sheet blocks are kept. On import the group is the first tag, or the folder
  the file was in, or `Imported`. Existing snippets are never overwritten; a numeric
  suffix is added instead.
- **Templates.** The zip holds the open project (documents, images, `.txt` and `.css`
  files) and a `template.json` with `id`, `name`, `version`, `grimoireVersion`
  (for example `>=0.1.0`; an older app refuses the template), `author`,
  `rootDirectory`, an optional `description` and an informational `structure` list.
  Hidden folders such as `.git` and `.cache`, other file types and view settings are
  left out; paths to files on your computer are made relative when they point inside the
  project and removed otherwise (the export lists each one as a warning). Choosing
  "structure only" keeps every path and its frontmatter but empties the documents.

Imports follow the same limits as any archive: at most 500 files and 50 MiB unpacked,
no unsafe, hidden-character or reserved names, and no names that differ only by case.
