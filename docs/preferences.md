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

Preferences has a left-hand section index and right-hand content: Appearance, Content folders, Shortcuts, and Auto save. Select a section or use Up/Down, Home, and End while focusing its tab. On narrow windows the index wraps above the content. Theme customization stays within Appearance; return with Back before switching sections.

Shortcuts lists the application bindings and the editor's existing formatting shortcuts. Ctrl+S saves all changed documents, Ctrl+O opens a file, and Ctrl+N creates a file through the same actions as File. Use Cmd instead of Ctrl on macOS. These file shortcuts do not run during dialogs, composition, or key repetition. Document editing supports Ctrl+Z, Ctrl+Shift+Z, Ctrl+B, Ctrl+I, and Ctrl+U. These are fixed defaults, not editable bindings.

Recent Folders is available under File rather than duplicated in the file explorer. It uses the existing recent-workspace history and opening behavior.

Hold Ctrl and scroll up over a page to zoom in, or down to zoom out. This follows the zoom selector's stops (25%–300% in editing view; 40%–100% in page preview), without changing document dimensions or PDF output. Regular scrolling is unchanged. Zoom shortcuts are listed in Shortcuts and are paused while a dialog is open.

## Editing columns and physical sheets

Text fills the first column to the bottom margin, then the second column, then the next sheet. Short documents are not balanced between columns while typing. Sheets have an 8 mm visual gap; theme backgrounds and ruler overlays repeat at each physical sheet's size. The document remains one continuous Markdown/editor buffer, including its undo history.

This editing layout requires native `column-height` and `column-wrap` support. Older WebViews show a notice and a readable single-column editing fallback without changing the saved column setting or Page View/PDF layout. Page View remains the print-layout reference. Free-positioned document images and content boxes retain their existing first-sheet coordinate system; repeated theme decorations are separate from those objects.


## Auto save

Settings > Preferences > Auto save defaults to 5 minutes. Enter minutes and seconds, then choose Apply interval; the total must be between 1 second and 24 hours. The value is stored as integer `settings.autoSaveSeconds` in `setting.json`, takes effect without restarting, and defaults to 300 for older settings. Callers omitting it preserve the saved value.

Only modified documents with existing file paths are saved, including inactive tabs. Untitled documents require one manual save and never trigger a timer-driven dialog. Saving uses the same serialized file-action queue and snapshot acknowledgement as manual Save: typing during a write remains dirty for the next save. Failed files remain dirty and report an error; other dirty files are still attempted. Timers begin after session restoration, never overlap writes, and wait for the selected interval after completion before trying again. Autosave never stages or commits Git changes.

## Configuration directory

On Windows the default configuration directory is `%APPDATA%/GriomoireMaker`; the application identifier remains `app.grimoiremaker.desktop`. On first launch with no new directory, the old configuration is copied through a private staging directory and published only after successful completion. The old directory is retained. Internal library paths are rebased to the new root; external custom paths and project/session paths are preserved. An existing new directory is authoritative, never merged with stale old settings. Migration failures abort startup and report the retained staging directory, rather than initialize over partial data. Linked/reparse files and directories are rejected.

The new root is shared by settings, session history, Mods, themes, logging, and workspace/Git authorization. Themes Path receives editable built-in examples and a README once per folder, without replacing existing files.

## Source control marker

The Git button shows a gold marker for saved uncommitted changes, including staged, unstaged and untracked files, even while its panel is collapsed. Status refreshes after app saves/Git operations, on window focus, and every five seconds. A failed refresh retains the last known marker and shows an unavailable indicator; unsaved editor buffers are distinct from Git's on-disk changes. Pack ZIP and Restore ZIP have been removed from File; template package import/export is unchanged.

## Project and page properties

Open **Properties** below Snippets for **Project properties** and **Page properties**. The panel remains available when Snippets is hidden.

Project **Book name**, **Author**, and optional **Co-Author** are also available in **Settings > Preferences > Project**. Changes save automatically when a field loses focus; **Save project settings** remains available for manual saving and retries. Both actions store them in `.grimoire-project.json` inside the project folder. These values are shared by all Markdown files, not global application preferences. A page-level author does not override the project author.

For the selected Markdown file, **Page title** and **Page columns** are saved with the file using Save or Auto save. Columns may be **Default**, **1 column**, or **2 columns**. Default inherits the application column setting; an explicit selection affects only that Markdown file (all physical sheets it produces). Editing, Page View, spreads, and PDF use the same override.

Project properties and Page properties are independently collapsible and start expanded. Collapsing a group preserves its fields.

Book name is project metadata shared by Properties, the toolbar title, and the theme placeholder {book}. The toolbar pencil edits this same value without renaming or moving the folder. Projects without a saved Book name display their folder name as a fallback.

Co-Author and Artist are link-style actions that open separate project credit lists. Each row stores **Name**, **Social media** (handle or URL), and **Platform**, for example `Midrava | @midrava | Instagram`. Use **Add artist** or **Add co-author** to add people, remove entries as needed, and use **Save** to save; Cancel or Escape discards the modal edits. Book name and Author keep their focus-leave auto-save and manual Save button.

Existing single Co-Author values appear as an initial list entry. The header/footer placeholder `{coAuthor}` displays the names from the saved list, separated by commas. Artist credits are retained in project settings. Neither list changes folder names.
