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

This stage loads declarative Markdown, not JavaScript or executable plugins.

## Importing external plugin packages

Mod Manager > Import Mod > Plugins > Plugin package (.zip / .gmp) installs a
downloaded plugin package. It is checked and stored apart from your local
plugins (`ManagedPlugins` in the application configuration folder) and is
left **off and unverified**. Importing never runs the package's code.

A package contains only `manifest.json` and `dist/index.js` (plus other files
under `dist/`). Hostile or malformed packages are rejected whole: paths that
escape the folder, links, duplicate names (ignoring case), reserved Windows
names, more than 256 entries, files over 8 MiB, more than 32 MiB in total or an
archive over 20 MiB. Installing a new version keeps the previous one and does not
carry over any approval. If installed files are later modified, the plugin is
marked as changed and must be removed and imported again. Install, approval,
activation, denied permission, forced stop and removal events are listed in
`ManagedPlugins/audit.log`.

### Running an external plugin

Choose **Review...** on the plugin card. The dialog shows the declared author
(never verified), the exact version and the permissions it asks for. **Approve
and activate** records the approval for that exact version, fingerprint and
permission set; any change to the package, or an update, asks again.

An approved plugin runs in an isolated frame: no access to your documents,
files, network, other plugins or the application's internals. It can only use
the listed permissions: `editor:zoom:read`, `editor:zoom:write`,
`editor:geometry:read` (page size and zoom, never text), `editor:guides:read`,
`editor:guides:write` and `editor:insert` (adds text the plugin author wrote; it cannot read your text). Its toolbar controls are drawn by the application from
the data in `manifest.json`. Before the first plugin starts, the application
runs an isolation self-test; if any check fails, external plugins stay off and
the card explains why. A plugin that hangs, errors repeatedly or floods requests
is stopped automatically and shows as stopped. **Turn off all imported plugins**
stops every one at once.

Plugin code is a single classic script (`dist/index.js`) that uses the `grimoire`
global: `grimoire.zoom.get/set/subscribe`, `grimoire.geometry.get/subscribe`,
`grimoire.guides.list/add/remove/subscribe` and `grimoire.onCommand(handler)`.
Every call returns a promise and is rejected without the matching permission.

Limits to know: the browser cannot cap a plugin's memory, so a plugin that
allocates without bound can slow or crash the application window; remove it.

### Zoom and Pixel Ruler, and package folders

Zoom and Pixel Ruler are example plugin packages. They are copied into
`Plugins/zoom` and `Plugins/pixel-ruler` on a new installation, and **Install** on
the Plugins tab puts a fresh copy back if you delete one. Each folder holds
`manifest.json`, an (empty) `dist/index.js` and an `index.md` that explains the
format. Edit them, press **Refresh**, and the change takes effect; the
application never overwrites your edits.

Any folder in `Plugins` with a regular `manifest.json` is a **package folder**:

- it runs isolated, exactly like an imported package, and is checked with the
  same rules and limits (only `manifest.json` and `dist/**` are used; links,
  reserved names, duplicate names and oversized files reject that folder only);
  other files, such as `index.md`, notes or a `legacy/` folder, are ignored;
- it is approved for exactly the permissions in its manifest, because you put
  the folder there, and it shows as a local package;
- turn it on or off with its switch in the Mod Manager, like any other mod; a
  running plugin whose files changed is restarted on Refresh;
- it may use a `builtin.*` id; an imported package cannot, and an imported
  plugin with the same id is never overridden (the folder reports an error);
- "Turn off all imported plugins" does not affect it.

A folder with TSX, TS or JS files and no `manifest.json` is a **trusted plugin**
folder (for example Bookmarks): it runs with the application's permissions and
is never treated as a package.

If you already have `Plugins/zoom` or `Plugins/pixel-ruler` from an older version:
- an **untouched** copy (documentation differences are ignored) is converted in
  place: its old code and style files are moved, not deleted, into
  `legacy/` inside the folder, and the package files and a new `index.md` are
  written;
- a copy you **edited or extended**, or a folder that already has a
  `manifest.json`, is left exactly as it is and keeps running as before.
The two implementations never run at the same time.

### Writing a plugin package

A package is a folder with `manifest.json` and `dist/index.js`. Build the entry
with any bundler into **one classic script** (for example an IIFE; no `import`,
no network, no DOM: the plugin runs in a Worker). TypeScript and TSX are
supported by compiling them first, e.g.
`esbuild src/index.ts --bundle --format=iife --outfile=dist/index.js`.
Then run `pnpm pack:plugin <folder> [--out <folder>]` to produce
`<id>-<version>.gmp`; the application checks the same limits again on import.

`manifest.json` (all fields required unless noted; unknown fields are rejected):

```json
{
  "schemaVersion": 1, "sdkVersion": 2,
  "id": "community.zoom-steps", "name": "Zoom Steps", "version": "1.0.0",
  "author": "You", "description": "What it does.",
  "main": "dist/index.js",
  "permissions": ["editor:zoom:read", "editor:zoom:write"],
  "contributions": { "toolbar": [ { "id": "zoom-in", "type": "button", "label": "Zoom +", "command": "zoom-in" } ] }
}
```

`id` matches `^[a-z0-9][a-z0-9._-]{0,63}$` and `builtin.*` is reserved for package folders in `Plugins`. Contributions
are data: the application draws them and shows every label as plain text.
- `toolbar` items: `button` or `select` with a `command` (delivered to
  `grimoire.onCommand`), or a control the application binds itself (sdkVersion 2):
  `select` with `bind: "zoom"` (editor zoom, needs `editor:zoom:write`),
  `select` with `bind: "surfaceZoom"` and `slot: "preview"`, or `toggle` with
  `bind: "rulerVisible"`. `when: "markdown"` enables a control only for Markdown files.
- A `button` may carry `"action": { "type": "insertMarkdown", "markdown": "..." }`
  instead of `command` or `bind` (exactly one of the three; sdkVersion 2; needs the
  `editor:insert` permission; `slot` must be `main`). Pressing it inserts that text
  at the cursor of the open Markdown document through the normal Markdown parser;
  the button is disabled when no Markdown document is open. The plugin runs no
  code for this. The text must be 1-8192 characters, may use only newline,
  carriage return and tab as control characters, may not contain zero-width or
  direction-changing characters, and may only use plain Markdown (an allow-list,
  checked on the text as written and again after decoding HTML entities, `%XX`
  escapes and backslash escapes, so `&#104;ttp://` and `&#0000000104;ttp://` are
  refused too): no raw HTML at all (a `<` followed by a letter, `/`, `!` or `?`
  starts a tag, comment or autolink; `a < 3` is fine); every link, image and
  `[label]: target` must be an anchor (`#a`) or a relative path (`./a.md`,
  `../b.png`, `a/b.png`), never a target with a scheme (`mailto:`, `tel:`,
  `asset:`, `blob:`, `c:`...), starting with `/` or `//`, or with a `:` before its
  first `/`; and the words `http:`, `https:`, `ftp:`, `ftps:`, `file:`, `ws:`,
  `wss:`, `data:`, `blob:`, `javascript:`, `vbscript:`, `asset:`, `tauri:`, `ipc:`,
  `www.example.com` and `//host.tld` are refused anywhere in the text, even in
  prose. Trade-off: ordinary text such as "data: 5", "File: notes" or code such as
  `Vec<String>` is refused too; rephrase it.
- `behaviors`: `{ "type": "wheelZoom", "editorSteps": [...], "previewSteps": [...] }`
  (whole percentages; Ctrl+wheel stepping drawn by the application; needs `editor:zoom:write`).
- `overlays`: `{ "type": "ruler" }` (page measurements, margin and bleed boxes and draggable
  guides; needs `editor:geometry:read`, `editor:guides:read` and `editor:guides:write`).
- `tools`: `{ "type": "guidesMenu", "label": "Guides" }` (needs the two guides permissions).

A plugin made only of such contributions needs an empty `dist/index.js`, as the
Zoom and Pixel Ruler example packages do.

Importing a plugin **folder** is different: it is copied as trusted local code
and runs with the application's permissions, without a sandbox.

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
