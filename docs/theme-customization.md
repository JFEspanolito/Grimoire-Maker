# Customize a theme

In Preferences, select a theme, then choose **Customize Theme**. Change Background, Text, H1, H2, H3, Divider, Accent, Stat block, or Read aloud colors. The isolated sample does not change the active document until Save. Divider color belongs to the theme; individual dividers do not store overrides.

Built-in and template themes always create a named copy. For a user theme, **Save** updates its existing file; **Save As** creates another theme. Names become safe unique file IDs. The editor retains the original font and layout CSS and appends a marked color-override block. It accepts opaque six-digit hex colors, not arbitrary CSS. Themes using other color expressions initially show picker defaults for those fields; review the sample before saving.

Files are written under the configured Themes Path. Successful catalog discovery precedes selecting the saved theme through the existing settings store and setting.json persistence. Saving a copy never overwrites an existing file, including an unrecognized theme file. A saved file that fails catalog reload remains on disk and an error is shown rather than claiming success.

## File safety and limits

- Updates reject linked files, changed source content, and a Themes Path changed since opening the editor.
- Existing files are never truncated: the editor writes a new same-directory temporary file, rechecks the original, and renames the completed copy into place. Failed publication retains the temporary copy and reports its location; it does not delete the original or fall back to direct writes.
- These are optimistic external-edit checks, not an operating-system lock. Another program modifying the original between the last check and rename can race with publication. Close external theme editors before saving.
- A failed new-file write can leave a partial new file. Its exclusive name is never reused or overwritten automatically. Review such files manually.
- The sample runs in a sandboxed iframe with network access blocked; externally loaded fonts or images may not appear there. Export and document rendering continue to use the existing theme selector contract.
- Desktop filesystem permissions and platform rename support still apply; browser-only mode cannot save themes.
