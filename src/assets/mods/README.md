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
`editor:geometry:read` (page size and zoom, never text), `editor:guides:read`
and `editor:guides:write`. Its toolbar controls are drawn by the application from
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
- `behaviors`: `{ "type": "wheelZoom", "editorSteps": [...], "previewSteps": [...] }`
  (whole percentages; Ctrl+wheel stepping drawn by the application; needs `editor:zoom:write`).
- `overlays`: `{ "type": "ruler" }` (page measurements, margin and bleed boxes and draggable
  guides; needs `editor:geometry:read`, `editor:guides:read` and `editor:guides:write`).
- `tools`: `{ "type": "guidesMenu", "label": "Guides" }` (needs the two guides permissions).

A plugin made only of such contributions needs an empty `dist/index.js`, as the
Zoom and Pixel Ruler example packages do.

Importing a plugin **folder** is different: it is copied as trusted local code
and runs with the application's permissions, without a sandbox.
