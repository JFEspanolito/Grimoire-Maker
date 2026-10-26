---
pluginName: Zoom
pluginId: builtin.zoom
pluginDescription: Editor and preview zoom selectors with Ctrl+wheel stepping.
---
# Zoom: an example plugin package

This folder is a complete plugin package. Use it as a starting point for your own mods.
Everything the application needs is in two files; this `index.md` is only documentation.

## What is in the folder

- `manifest.json` describes the plugin. The application reads it and draws the controls for you.
- `dist/index.js` is the plugin's code. For Zoom it is empty on purpose: the zoom selectors and the
  Ctrl+wheel behavior are drawn and handled by the application, so no code is needed.
- Any other file here (this page, notes, a `legacy/` folder) is ignored.

## manifest.json, field by field

- `id`, `name`, `version`, `author`, `description`: who the plugin is. `id` must be unique.
  Local packages may use a `builtin.` id, like this one; imported packages cannot.
- `main`: the entry file, always `dist/index.js`.
- `schemaVersion` and `sdkVersion`: format versions. Leave them as they are.
- `permissions`: what the plugin may do. Zoom asks for two:
  `editor:zoom:read` (see the current zoom) and `editor:zoom:write` (change it).
  A local package is approved for exactly the permissions listed here, so remove any it does not use.
- `contributions`: the controls the application draws.
  - `toolbar` has two dropdowns. `zoom-editor` is bound to the editor zoom (`"bind": "zoom"`) and
    shows only for Markdown files. `zoom-preview` is bound to the print preview zoom
    (`"bind": "surfaceZoom"`, `"slot": "preview"`). Each `options` entry is a value and its label.
  - `behaviors` has `zoom-wheel`, which makes Ctrl+wheel step through `editorSteps` in the editor
    and `previewSteps` in the preview (whole percentages, ascending).

## Edit it

1. Change `manifest.json`, for example remove a step from `editorSteps` and the matching option.
2. Open **Mod Manager** and choose **Refresh**. A running plugin whose files changed is restarted.
3. Use **Turn off** or **Turn on** on the card to switch it. Your edits are never overwritten.

If you delete the folder, the plugin disappears. **Install** on the Plugins tab puts a fresh copy back.

## Share it

Copy the whole `zoom` folder into another installation's **Plugins** folder, or pack it:

```
pnpm pack:plugin <path to this folder>
```

This writes a `.gmp` file that others can add with **Mod Manager > Import Mod**. Imported packages
are approved by the person who imports them, so they start off until reviewed.
