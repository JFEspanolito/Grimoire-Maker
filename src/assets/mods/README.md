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
left **disabled and unverified**. Importing never runs the package's code, and
external plugins cannot be enabled until the isolated runtime exists.

A package contains only `manifest.json` and `dist/index.js` (plus other files
under `dist/`). Hostile or malformed packages are rejected whole: paths that
escape the folder, links, duplicate names (ignoring case), reserved Windows
names, more than 256 entries, files over 8 MiB, more than 32 MiB in total or an
archive over 20 MiB. Installing a new version keeps the previous one and does not
carry over any approval. If installed files are later modified, the plugin is
marked as changed and must be removed and imported again. Install, removal and
integrity events are listed in `ManagedPlugins/audit.log`.

Importing a plugin **folder** is different: it is copied as trusted local code
and runs with the application's permissions, without a sandbox.
