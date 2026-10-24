# Library directory preferences

Settings → Preferences selects directories for Plugins, Snippets, Templates, Themes, and Logs. The native directory picker copies the active category's contents, then persists the new directory in `setting.json` in the application configuration directory. That file contains `paths` and `settings` (theme, page size, columns, guides, and editing zoom). A single native lock serializes settings updates, path changes, and log appends, preserving the other section. Paths are restored before frontend startup and on each directory lookup.

No restart is required. After a successful path change, the application reloads themes, templates, and snippets in place. Reload failures are shown separately from successful path persistence. Plugin Path remains storage-only until executable plugin support is introduced.

Visual ruler guides also persist in `settings.rulerGuides`. See [Ruler guides](ruler.md) for adding, moving, and removing them. Older settings without that optional field remain supported.

Editing zoom persists in optional `settings.zoom`, between `0.25` and `3` (25%–300%); the frontend defaults to `1` when absent. Appearance saves that omit zoom or guides retain their existing values. Zoom affects the editor view, not document/PDF physical dimensions.

On first use, existing `library-paths.json` and `state.json.settings` are copied into `setting.json`. Legacy files remain intact. Once created, `setting.json` is authoritative: stale legacy values are never merged back, and malformed settings are reported rather than silently replaced. `state.json` remains responsible for workspace/session history; its legacy settings copy is retained but no longer updated. Existing Mod Manager activation data in `mods.json` is unchanged.

Defaults are `Mods/Plugins`, `Mods/Snippets`, `Mods/Templates`, `themes`, and `logs` under application configuration. Older preferences missing only `paths.logs` receive the default Logs directory without resetting other paths or settings. Shipped Markdown examples initialize only the default Mods library; selecting a custom directory does not seed extra examples there. Mod activation IDs retain their category/package identity when paths change. ZIP template imports use the configured Templates directory. See [Error logs](error-logs.md) for capture limits and safe sharing.

Copying retains originals, nested assets, binary data, dotfiles, and empty directories. Existing destination entries are never overwritten or merged. Equal, ancestor, descendant, and other active-library overlaps are rejected, as are links, Windows reparse points, and special files. Native changes are serialized. Windows directory handles prevent ancestor replacement during copying. Cancelling, copy failure, scope failure, or preference-publication failure leaves the old active preference and source unchanged. An interrupted/failed operation may leave copied files or a temporary preferences file; these are intentionally retained rather than deleted automatically. Select a clean destination after inspecting any partial copy.

Configured directories must remain present and accessible; missing directories or invalid preferences produce an error instead of silently resetting the library. The native backend restores only the configured directory scopes; it does not change capability files or use workspace restoration to authorize library paths. Theme files are CSS only; Plugins are configurable storage only and no external executable plugin code is loaded.

The legacy `templates` directory under application configuration remains a separate compatibility source. Changing the modern Templates path does not relocate that legacy folder. Modern package IDs continue to take precedence over matching legacy IDs, including disabled modern packages. Theme selection uses the existing theme catalog and document/settings persistence.

## Sections and shortcuts

Preferences has a left-hand section index and right-hand content: Appearance, Content folders, and Shortcuts. Select a section or use Up/Down, Home, and End while focusing its tab. On narrow windows the index wraps above the content. Theme customization stays within Appearance; return with Back before switching sections.

Shortcuts lists the application bindings and the editor's existing formatting shortcuts. Ctrl+S saves all changed documents, Ctrl+O opens a file, and Ctrl+N creates a file through the same actions as File. Use Cmd instead of Ctrl on macOS. These file shortcuts do not run during dialogs, composition, or key repetition. Document editing supports Ctrl+Z, Ctrl+Shift+Z, Ctrl+B, Ctrl+I, and Ctrl+U. These are fixed defaults, not editable bindings.

Recent Folders is available under File rather than duplicated in the file explorer. It uses the existing recent-workspace history and opening behavior.
