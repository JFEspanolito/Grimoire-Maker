# Library directory preferences

Settings → Preferences selects directories for Plugins, Snippets, Templates, and Themes. The native directory picker copies the active category's contents, then persists the new directory in `setting.json` in the application configuration directory. That file contains `paths` and `settings` (theme, page size, and columns). A single native lock serializes both kinds of updates, preserving the other section. Paths are restored before frontend startup and on each directory lookup.

No restart is required. After a successful path change, the application reloads themes, templates, and snippets in place. Reload failures are shown separately from successful path persistence. Plugin Path remains storage-only until executable plugin support is introduced.

Visual ruler guides also persist in `settings.rulerGuides`. See [Ruler guides](ruler.md) for adding, moving, and removing them. Older settings without that optional field remain supported.

On first use, existing `library-paths.json` and `state.json.settings` are copied into `setting.json`. Legacy files remain intact. Once created, `setting.json` is authoritative: stale legacy values are never merged back, and malformed settings are reported rather than silently replaced. `state.json` remains responsible for workspace/session history; its legacy settings copy is retained but no longer updated. Existing Mod Manager activation data in `mods.json` is unchanged.

Defaults are `Mods/Plugins`, `Mods/Snippets`, `Mods/Templates`, and `themes` under application configuration. Shipped Markdown examples initialize only the default Mods library; selecting a custom directory does not seed extra examples there. Mod activation IDs retain their category/package identity when paths change. ZIP template imports use the configured Templates directory.

Copying retains originals, nested assets, binary data, dotfiles, and empty directories. Existing destination entries are never overwritten or merged. Equal, ancestor, descendant, and other active-library overlaps are rejected, as are links, Windows reparse points, and special files. Native changes are serialized. Windows directory handles prevent ancestor replacement during copying. Cancelling, copy failure, scope failure, or preference-publication failure leaves the old active preference and source unchanged. An interrupted/failed operation may leave copied files or a temporary preferences file; these are intentionally retained rather than deleted automatically. Select a clean destination after inspecting any partial copy.

Configured directories must remain present and accessible; missing directories or invalid preferences produce an error instead of silently resetting the library. The native backend restores only the configured directory scopes; it does not change capability files or use workspace restoration to authorize library paths. Theme files are CSS only; Plugins are configurable storage only and no external executable plugin code is loaded.

The legacy `templates` directory under application configuration remains a separate compatibility source. Changing the modern Templates path does not relocate that legacy folder. Modern package IDs continue to take precedence over matching legacy IDs, including disabled modern packages. Theme selection uses the existing theme catalog and document/settings persistence.
