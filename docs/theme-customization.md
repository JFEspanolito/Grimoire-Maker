# Customize a theme

In Preferences, select a theme, then choose **Customize Theme**. Change Background, Text, H1, H2, H3, Divider, Accent, Stat block, or Read aloud colors. The isolated sample does not change the active document until Save. Divider color belongs to the theme; individual dividers do not store overrides.

Embedded fallback and template themes create a named copy. The default themes installed as CSS examples are user-editable files. For a user theme, **Save** updates its existing file; **Save As** creates another theme. Names become safe unique file IDs. The editor retains the original font and layout CSS and appends a marked color-override block. It accepts opaque six-digit hex colors, not arbitrary CSS. Themes using other color expressions initially show picker defaults for those fields; review the sample before saving.

Files are written under the configured Themes Path. Successful catalog discovery precedes selecting the saved theme through the existing settings store and setting.json persistence. Saving a copy never overwrites an existing file, including an unrecognized theme file. A saved file that fails catalog reload remains on disk and an error is shown rather than claiming success.

## File safety and limits

- Updates reject linked files, changed source content, and a Themes Path changed since opening the editor.
- Existing files are never truncated: the editor writes a new same-directory temporary file, rechecks the original, and renames the completed copy into place. Failed publication retains the temporary copy and reports its location; it does not delete the original or fall back to direct writes.
- These are optimistic external-edit checks, not an operating-system lock. Another program modifying the original between the last check and rename can race with publication. Close external theme editors before saving.
- A failed new-file write can leave a partial new file. Its exclusive name is never reused or overwritten automatically. Review such files manually.
- The sample runs in a sandboxed iframe with network access blocked; externally loaded fonts or images may not appear there. Export and document rendering continue to use the existing theme selector contract.
- Desktop filesystem permissions and platform rename support still apply; browser-only mode cannot save themes.

## Repeating page backgrounds

In Customize Theme, open **Page backgrounds → Import image…**. Import PNG, JPEG or WebP artwork, then drag it on the placement sheet. Artwork in the lower half anchors to the footer; upper artwork anchors to the header. The image selector allows overlapping images to be selected independently. Use Anchor, Left, Edge offset and Width for precise placement, or arrow keys (Shift for larger steps) while an image is focused. Remove image removes only that decoration.

Save embeds the artwork into the theme CSS; no document asset path or temporary blob URL is required. Save As retains the images in the independent copy. The same backgrounds appear behind text on the editing sheet and on every physical page in Page View/PDF, including new documents using that theme. These are decorations, not document image nodes, and do not push text.

Import accepts raster files up to 10 MB and 16 megapixels, normalizes them to PNG at a maximum 1600-pixel edge, and preserves transparency. Each processed image is limited to 2 MB, the combined embedded URLs to 8 MB, and a theme to 24 MB. SVG is intentionally excluded. Theme files remain self-contained for sharing or moving the Themes Path. Before pagination/printing, embedded backgrounds must finish loading; a decoding error stops export rather than silently omitting artwork.


## Editable examples

The first scan of Themes Path installs `dark-fantasy.css`, `modern.css`, `parchment.css`, `sci-fi.css`, and `README.md` using exclusive creation. Existing files are never replaced. A hidden `.grimoire-theme-examples-v1` marker prevents later launches from recreating deleted examples or overwriting edits.

To make a theme, copy an example, rename its CSS file, replace every `data-theme` selector with the new filename stem, and edit the `@name` comment. Return to the app to reload. Valid disk versions replace the corresponding embedded theme without duplicate catalog entries; missing or invalid files use the original embedded fallback. Customize Theme reads and updates the disk version, not a stale built-in copy. These plain CSS files can be shared as mods.

Customize Theme replaces the Preferences navigation with Theme name, Colors, Backgrounds, and Header and footer. Header and footer provides left, center, and right text slots for each area. Use fixed text or {book}, {title}, {author}, {page}, and {pages}. These values are saved with the theme; switching sections preserves unsaved edits.

Header/footer placeholders include `{coAuthor}`. Set Author and Co-Author in Project properties or Settings > Preferences > Project; the same project credits are used on every page. The customizer preview uses saved project credits when present and sample values otherwise. Saved header/footer layouts are rendered in editing, Page View, spreads, and PDF with the current page number and total.
