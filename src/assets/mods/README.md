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
