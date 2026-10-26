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
is stopped automatically and shows as stopped. **Disable all external plugins**
stops every one at once.

Plugin code is a single classic script (`dist/index.js`) that uses the `grimoire`
global: `grimoire.zoom.get/set/subscribe`, `grimoire.geometry.get/subscribe`,
`grimoire.guides.list/add/remove/subscribe` and `grimoire.onCommand(handler)`.
Every call returns a promise and is rejected without the matching permission.

Limits to know: the browser cannot cap a plugin's memory, so a plugin that
allocates without bound can slow or crash the application window; remove it.

### Zoom and Pixel Ruler

Zoom and Pixel Ruler now ship inside the application as bundled isolated
packages (`builtin.zoom`, `builtin.pixel-ruler`). They are pre-approved, drawn by
the application from their manifests, listed as "Bundled with the app", cannot
be removed (only deactivated) and are not stopped by "Disable all external
plugins". New installations no longer copy their old source folders. If you
already have `Plugins/zoom` or `Plugins/pixel-ruler`:
- an **untouched** copy is left on disk but not loaded (the bundled plugin runs);
- a copy you **edited or extended** keeps running and the bundled plugin stays
  off, so your changes are never overridden. Delete the folder or restore the
  original files to switch to the bundled version.
The two never run at the same time.

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

`id` matches `^[a-z0-9][a-z0-9._-]{0,63}$` and `builtin.*` is reserved. Contributions
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
Zoom and Pixel Ruler packages that ship with the application do.

Importing a plugin **folder** is different: it is copied as trusted local code
and runs with the application's permissions, without a sandbox.
