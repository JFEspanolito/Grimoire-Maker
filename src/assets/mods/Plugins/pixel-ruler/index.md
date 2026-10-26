---
pluginName: Pixel Ruler
pluginId: builtin.pixel-ruler
pluginDescription: Page ruler with margin and bleed boxes and draggable guides.
---
# Pixel Ruler: an example plugin package

This folder is a complete plugin package. Use it as a starting point for your own mods.
Everything the application needs is in two files; this `index.md` is only documentation.

## What is in the folder

- `manifest.json` describes the plugin. The application reads it and draws the controls for you.
- `dist/index.js` is the plugin's code. For Pixel Ruler it is empty on purpose: the ruler, the
  margin and bleed boxes and the guides are drawn by the application, so no code is needed.
- Any other file here (this page, notes, a `legacy/` folder) is ignored.

## manifest.json, field by field

- `id`, `name`, `version`, `author`, `description`: who the plugin is. `id` must be unique.
  Local packages may use a `builtin.` id, like this one; imported packages cannot.
- `main`: the entry file, always `dist/index.js`.
- `schemaVersion` and `sdkVersion`: format versions. Leave them as they are.
- `permissions`: what the plugin may do. Pixel Ruler asks for three:
  `editor:geometry:read` (page size and zoom, never text), `editor:guides:read` (see guides) and
  `editor:guides:write` (add and remove guides).
  A local package is approved for exactly the permissions listed here, so remove any it does not use.
- `contributions`: the controls the application draws.
  - `toolbar` has `ruler-toggle`, a toggle bound to ruler visibility (`"bind": "rulerVisible"`)
    that shows only for Markdown files.
  - `overlays` has `ruler`, the ruler drawn over the page with its margin and bleed boxes.
  - `tools` has `guides`, a **Guides** menu to add, clear and remove guides.

## Edit it

1. Change `manifest.json`, for example rename the toggle label or the menu label.
2. Open **Mod Manager** and choose **Refresh**. A running plugin whose files changed is restarted.
3. Use **Turn off** or **Turn on** on the card to switch it. Your edits are never overwritten.

If you delete the folder, the plugin disappears. **Install** on the Plugins tab puts a fresh copy back.

## Share it

Copy the whole `pixel-ruler` folder into another installation's **Plugins** folder, or pack it:

```
pnpm pack:plugin <path to this folder>
```

This writes a `.gmp` file that others can add with **Mod Manager > Import Mod**. Imported packages
are approved by the person who imports them, so they start off until reviewed.
