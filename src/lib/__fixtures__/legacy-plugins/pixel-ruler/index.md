---
pluginName: Ruler
pluginId: builtin.pixel-ruler
---
# Pixel & Print Ruler

This folder contains the complete Ruler implementation. `pixel-ruler.tsx`
exports the plugin, toolbar toggle and registrations. The remaining files own
the overlay, guide menu, guide updates, measurement visibility and styles.
This Markdown file is documentation, not the implementation.

## Install and share

Copy this entire `pixel-ruler` folder into the configured **Plugins** content
folder on another Grimoire Maker installation with the v1 plugin API. Refresh
the mod catalog and enable **Ruler**. No build step or npm installation is
needed. Keep the source files and `Ruler.module.css` together. Do not install a
second copy with the same ID: `builtin.pixel-ruler`.

## Controls

- **Ruler** shows or hides page dimensions, margins and bleed measurements.
- **Guides** adds row/column guides, edits positions in millimetres, removes
  individual guides or clears them all.
- Drag a guide handle to position it. Changes commit on release; cancellation
  discards the draft. Arrow keys move by 1 mm, Shift+arrow by 10 mm, and Delete
  removes the selected guide.
- Guides remain visible when measurements are hidden. Guides outside a smaller
  paper size are retained and marked in the menu, not silently deleted.
- Guides are visual only and do not appear in printed/exported pages.

## Lifecycle and host API

Activation registers generic toolbar, editor-tool and overlay slots. The host
owns persisted guide coordinates and page geometry through
`@grimoire/plugin-api`; this package owns their interaction and rendering.
`GuidesMenu` removes its outside-click listener on unmount. The registry removes
registered UI/styles on disable, and cleanup resets transient measurement
visibility without deleting saved guide positions. Re-enable restores the
saved guides.

These are trusted same-WebView plugins, **not sandboxed extensions**. Their
code has application authority. Only enable reviewed code; protection for
external plugins belongs to a later phase.
